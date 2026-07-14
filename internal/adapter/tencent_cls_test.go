package adapter

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	cls "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/cls/v20201016"

	"github.com/liangguifeng/LogGopher/internal/domain"
)

// fakeTencentClient captures API 3.0 requests without contacting Tencent Cloud.
type fakeTencentClient struct {
	describeResponses []*cls.DescribeTopicsResponse
	describeErrors    []error
	describeRequests  []*cls.DescribeTopicsRequest
	searchResponses   []*cls.SearchLogResponse
	searchErrors      []error
	searchRequests    []*cls.SearchLogRequest
}

func (client *fakeTencentClient) DescribeTopicsWithContext(
	_ context.Context,
	request *cls.DescribeTopicsRequest,
) (*cls.DescribeTopicsResponse, error) {
	client.describeRequests = append(client.describeRequests, request)
	index := len(client.describeRequests) - 1
	if index < len(client.describeErrors) && client.describeErrors[index] != nil {
		return nil, client.describeErrors[index]
	}
	return client.describeResponses[index], nil
}

func (client *fakeTencentClient) SearchLogWithContext(
	_ context.Context,
	request *cls.SearchLogRequest,
) (*cls.SearchLogResponse, error) {
	client.searchRequests = append(client.searchRequests, request)
	index := len(client.searchRequests) - 1
	if index < len(client.searchErrors) && client.searchErrors[index] != nil {
		return nil, client.searchErrors[index]
	}
	return client.searchResponses[index], nil
}

func tencentTestInput() domain.ConnectionInput {
	return domain.ConnectionInput{
		AdapterID: "tencent-cls", Name: "guangzhou-production",
		Endpoint: "https://cls.tencentcloudapi.com", Region: "ap-guangzhou",
		AccessKey: "test-secret-id", SecretKey: "test-secret-key",
	}
}

func TestTencentCLSConnectPaginatesAndCachesTopics(t *testing.T) {
	client := &fakeTencentClient{describeResponses: []*cls.DescribeTopicsResponse{
		{Response: &cls.DescribeTopicsResponseParams{
			Topics: []*cls.TopicInfo{
				{TopicId: stringPointer("topic-11111111"), TopicName: stringPointer("application")},
			},
			TotalCount: int64Pointer(2),
		}},
		{Response: &cls.DescribeTopicsResponseParams{
			Topics: []*cls.TopicInfo{
				{TopicId: stringPointer("topic-22222222"), TopicName: stringPointer("application")},
			},
			TotalCount: int64Pointer(2),
		}},
	}}
	adapter := &tencentCLSAdapter{
		newClient: func(context.Context, domain.ConnectionInput) (tencentCLSClient, error) {
			return client, nil
		},
		topics: make(map[string]map[string]string),
	}
	groups, err := adapter.Connect(context.Background(), tencentTestInput())
	if err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	if len(groups) != 1 || len(groups[0].Logstores) != 2 || groups[0].Logstores[0] != "application · topic-11" || groups[0].Logstores[1] != "application · topic-22" {
		t.Fatalf("Connect() groups = %#v", groups)
	}
	if len(client.describeRequests) != 2 || *client.describeRequests[1].Offset != 100 {
		t.Fatalf("DescribeTopics requests = %#v", client.describeRequests)
	}
	if topicID, ok := adapter.topicID(tencentTestInput(), groups[0].Logstores[1]); !ok || topicID != "topic-22222222" {
		t.Fatalf("cached Topic = %q, %v", topicID, ok)
	}
}

func TestTencentCLSQueryMapsRequestAndNormalizesLogs(t *testing.T) {
	logTime := time.Date(2026, 7, 12, 1, 2, 3, 456000000, time.UTC)
	listOver := true
	client := &fakeTencentClient{searchResponses: []*cls.SearchLogResponse{
		{Response: &cls.SearchLogResponseParams{
			ListOver: &listOver,
			Results: []*cls.LogInfo{{
				Time: int64Pointer(logTime.UnixMilli()), TopicName: stringPointer("application"),
				Source:  stringPointer("10.0.0.8"),
				LogJson: stringPointer(`{"level":"warn","message":"upstream slow","service":"gateway","status":429}`),
			}},
		}},
		{Response: &cls.SearchLogResponseParams{
			Analysis: boolPointer(true),
			AnalysisRecords: []*string{
				stringPointer(`{"loggopher_time":"2026-07-12T08:00:00+08:00","loggopher_count":"20"}`),
				stringPointer(`{"loggopher_time":"2026-07-12T08:04:00+08:00","loggopher_count":"27"}`),
			},
		}},
	}}
	input := tencentTestInput()
	adapter := &tencentCLSAdapter{
		newClient: func(context.Context, domain.ConnectionInput) (tencentCLSClient, error) {
			return client, nil
		},
		topics: map[string]map[string]string{
			tencentConnectionKey(input): {"application": "topic-id"},
		},
	}
	result, err := adapter.Query(context.Background(), input, domain.QueryInput{
		Logstore: "application", Query: "level:warn",
		From: "2026-07-12T00:00:00Z", To: "2026-07-12T01:00:00Z", Page: 2, Limit: 20,
	})
	if err != nil {
		t.Fatalf("Query() error = %v", err)
	}
	request := client.searchRequests[0]
	if *request.TopicId != "topic-id" || *request.QueryString != `"WARN"` ||
		*request.QuerySyntax != 1 || *request.Sort != "desc" || *request.Limit != 20 || *request.Offset != 20 {
		t.Fatalf("SearchLog request = %#v", request)
	}
	if *request.From != 1783814400000 || *request.To != 1783818000000 {
		t.Fatalf("SearchLog range = %d..%d", *request.From, *request.To)
	}
	if len(client.searchRequests) != 2 ||
		!strings.Contains(*client.searchRequests[1].QueryString, "time_series(__TIMESTAMP__, '4m'") {
		t.Fatalf("histogram request = %#v", client.searchRequests)
	}
	if result.Total != 47 || len(result.Entries) != 1 || len(result.Histogram) != 2 {
		t.Fatalf("Query() = %#v", result)
	}
	if result.Histogram[0].From != "2026-07-12T00:00:00Z" ||
		result.Histogram[0].To != "2026-07-12T00:04:00Z" || result.Histogram[1].Count != 27 {
		t.Fatalf("normalized histogram = %#v", result.Histogram)
	}
	entry := result.Entries[0]
	if entry.Time != "2026-07-12T01:02:03.456Z" || entry.Level != "WARN" ||
		entry.Message != "upstream slow" || entry.Fields["service"] != "gateway" ||
		entry.Fields["status"] != "429" || entry.Fields["__source__"] != "10.0.0.8" {
		t.Fatalf("normalized entry = %#v", entry)
	}
}

func TestTencentCLSRejectsInvalidInputAndCancelledContext(t *testing.T) {
	input := tencentTestInput()
	input.Region = ""
	if err := validateTencentInput(input); err == nil {
		t.Fatal("validateTencentInput() must require region")
	}
	adapter := &tencentCLSAdapter{
		newClient: func(context.Context, domain.ConnectionInput) (tencentCLSClient, error) {
			t.Fatal("SDK client must not be created")
			return nil, nil
		},
		topics: make(map[string]map[string]string),
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := adapter.Connect(ctx, tencentTestInput())
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled Connect() error = %v", err)
	}
}

func TestTencentCLSAdapterIsReadyAndDemoIsRemoved(t *testing.T) {
	registry := DefaultRegistry()
	registered, ok := registry.Get("tencent-cls")
	if !ok || !registered.Info().Ready {
		t.Fatalf("registered CLS adapter = %#v, ok = %v", registered, ok)
	}
	if _, ok := registry.Get("demo"); ok {
		t.Fatal("demo adapter must not remain registered")
	}
	for _, info := range registry.List() {
		if info.ID == "demo" {
			t.Fatal("demo adapter must not remain visible")
		}
	}
}
