package adapter

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	sls "github.com/aliyun/aliyun-log-go-sdk"
	"github.com/liangguifeng/LogGopher/internal/domain"
)

// fakeAliyunClient captures SDK requests without contacting Alibaba Cloud.
type fakeAliyunClient struct {
	projects         []sls.LogProject
	projectOffsets   []int
	logstores        []string
	listErr          error
	logs             *sls.GetLogsResponse
	logsErr          error
	logsErrors       []error
	histogram        *sls.GetHistogramsResponse
	histogramErr     error
	index            *sls.Index
	indexErr         error
	logRequest       *sls.GetLogRequest
	logRequests      []*sls.GetLogRequest
	histogramRequest *sls.GetHistogramRequest
	project          string
	logstore         string
}

func (client *fakeAliyunClient) ListProjectV2(offset, size int) ([]sls.LogProject, int, int, error) {
	client.projectOffsets = append(client.projectOffsets, offset)
	projects := client.projects
	if projects == nil {
		projects = []sls.LogProject{{Name: "project-a"}}
	}
	if offset >= len(projects) {
		return nil, 0, len(projects), nil
	}
	end := min(offset+size, len(projects))
	return projects[offset:end], end - offset, len(projects), nil
}

func (client *fakeAliyunClient) ListLogStore(project string) ([]string, error) {
	client.project = project
	return client.logstores, client.listErr
}

func (client *fakeAliyunClient) GetIndex(project, logstore string) (*sls.Index, error) {
	client.project, client.logstore = project, logstore
	return client.index, client.indexErr
}

func (client *fakeAliyunClient) GetLogsToCompletedV2(project, logstore string, request *sls.GetLogRequest) (*sls.GetLogsResponse, error) {
	client.project, client.logstore, client.logRequest = project, logstore, request
	requestCopy := *request
	client.logRequests = append(client.logRequests, &requestCopy)
	if len(client.logRequests) <= len(client.logsErrors) {
		return nil, client.logsErrors[len(client.logRequests)-1]
	}
	return client.logs, client.logsErr
}

func (client *fakeAliyunClient) GetHistogramsToCompletedV2(project, logstore string, request *sls.GetHistogramRequest) (*sls.GetHistogramsResponse, error) {
	client.histogramRequest = request
	return client.histogram, client.histogramErr
}

func aliyunTestInput() domain.ConnectionInput {
	return domain.ConnectionInput{
		AdapterID: "aliyun-sls", Name: "production", Endpoint: "https://cn-hangzhou.log.aliyuncs.com",
		AccessKey: "test-ak", SecretKey: "test-sk",
	}
}

func TestAliyunSLSConnectListsLogstores(t *testing.T) {
	fake := &fakeAliyunClient{logstores: []string{"access", "application"}}
	adapter := &aliyunSLSAdapter{newClient: func(context.Context, domain.ConnectionInput) (aliyunSLSClient, error) { return fake, nil }}

	groups, err := adapter.Connect(context.Background(), aliyunTestInput())
	if err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	if fake.project != "project-a" || len(groups) != 1 || len(groups[0].Logstores) != 2 || groups[0].Logstores[0] != "access" {
		t.Fatalf("Connect() = %#v, project = %q", groups, fake.project)
	}
}

func TestListAllAliyunProjectsPaginatesAndSorts(t *testing.T) {
	projects := make([]sls.LogProject, 501)
	for index := range projects {
		projects[index].Name = fmt.Sprintf("project-%03d", 500-index)
	}
	fake := &fakeAliyunClient{projects: projects}
	names, err := listAllAliyunProjects(context.Background(), fake)
	if err != nil {
		t.Fatalf("listAllAliyunProjects() error = %v", err)
	}
	if len(names) != 501 || names[0] != "project-000" || names[500] != "project-500" {
		t.Fatalf("projects = %#v", names)
	}
	if len(fake.projectOffsets) != 2 || fake.projectOffsets[0] != 0 || fake.projectOffsets[1] != 500 {
		t.Fatalf("offsets = %#v", fake.projectOffsets)
	}
}

func TestAliyunSLSQueryMapsPaginationAndNormalizesLogs(t *testing.T) {
	fake := &fakeAliyunClient{
		logs: &sls.GetLogsResponse{Count: 1, Logs: []map[string]string{{
			"__time__": "1783818000", "__time_ns_part__": "123000000", "LEVEL": "warn",
			"message": "upstream slow", "service": "gateway", "status": "429",
		}}},
		histogram: &sls.GetHistogramsResponse{Count: 47, Histograms: []sls.SingleHistogram{
			{From: 1783814400, To: 1783816200, Count: 20},
			{From: 1783816200, To: 1783818000, Count: 27},
		}},
	}
	adapter := &aliyunSLSAdapter{newClient: func(context.Context, domain.ConnectionInput) (aliyunSLSClient, error) { return fake, nil }}
	result, err := adapter.Query(context.Background(), aliyunTestInput(), domain.QueryInput{
		Group: "project-a", Logstore: "access", Query: " status:429 | select count(*) ",
		From: "2026-07-12T00:00:00Z", To: "2026-07-12T01:00:00Z", Page: 2, Limit: 20,
	})
	if err != nil {
		t.Fatalf("Query() error = %v", err)
	}
	if fake.logRequest.Lines != 20 || fake.logRequest.Offset != 20 || !fake.logRequest.Reverse {
		t.Fatalf("GetLogs request = %#v", fake.logRequest)
	}
	if fake.logRequest.IsAccurate == nil || !*fake.logRequest.IsAccurate {
		t.Fatal("GetLogs request must enable accurate matching")
	}
	if fake.histogramRequest.Query != "status:429" {
		t.Fatalf("histogram query = %q", fake.histogramRequest.Query)
	}
	if result.Total != 47 || len(result.Entries) != 1 || len(result.Histogram) != 2 {
		t.Fatalf("Query() = %#v", result)
	}
	if result.Histogram[0].From != "2026-07-12T00:00:00Z" || result.Histogram[1].Count != 27 {
		t.Fatalf("normalized histogram = %#v", result.Histogram)
	}
	entry := result.Entries[0]
	if entry.Level != "WARN" || entry.Message != "upstream slow" || entry.Fields["service"] != "gateway" {
		t.Fatalf("normalized entry = %#v", entry)
	}
	if entry.MessageField != "message" {
		t.Fatalf("message field = %q", entry.MessageField)
	}
	if entry.Time != "2026-07-12T01:00:00.123Z" {
		t.Fatalf("normalized time = %q", entry.Time)
	}
	if _, exists := entry.Fields["LEVEL"]; exists {
		t.Fatal("normalized fields must not duplicate the level")
	}
}

func TestAliyunSLSQueryUsesWildcardAndCapsPageSize(t *testing.T) {
	fake := &fakeAliyunClient{
		logs:      &sls.GetLogsResponse{},
		histogram: &sls.GetHistogramsResponse{},
	}
	adapter := &aliyunSLSAdapter{newClient: func(context.Context, domain.ConnectionInput) (aliyunSLSClient, error) { return fake, nil }}
	_, err := adapter.Query(context.Background(), aliyunTestInput(), domain.QueryInput{
		Group: "project-a", Logstore: "access", From: "2026-07-12T00:00:00Z", To: "2026-07-12T01:00:00Z", Page: 1, Limit: 500,
	})
	if err != nil {
		t.Fatalf("Query() error = %v", err)
	}
	if fake.logRequest.Query != "*" || fake.logRequest.Lines != 100 {
		t.Fatalf("GetLogs request = %#v", fake.logRequest)
	}
}

func TestAliyunSLSQueryKeepsProviderNativeLevelFilter(t *testing.T) {
	fake := &fakeAliyunClient{
		logs:      &sls.GetLogsResponse{},
		histogram: &sls.GetHistogramsResponse{},
		index: &sls.Index{Keys: map[string]sls.IndexKey{
			"message": {Type: "json", JsonKeys: map[string]*sls.JsonKey{
				"level_name": {Type: "text"},
			}},
		}, Line: &sls.IndexLine{}},
	}
	adapter := &aliyunSLSAdapter{
		newClient: func(context.Context, domain.ConnectionInput) (aliyunSLSClient, error) {
			return fake, nil
		},
	}
	result, err := adapter.Query(context.Background(), aliyunTestInput(), domain.QueryInput{
		Group: "project-a", Logstore: "access", Query: `service:"api" AND level:"WARN"`,
		From: "2026-07-12T00:00:00Z", To: "2026-07-12T01:00:00Z", Page: 1, Limit: 20,
	})
	if err != nil {
		t.Fatalf("Query() error = %v", err)
	}
	want := `service:"api" AND level:"WARN"`
	if fake.logRequest.Query != want || fake.histogramRequest.Query != want {
		t.Fatalf("native level requests = logs %q, histogram %q", fake.logRequest.Query, fake.histogramRequest.Query)
	}
	if len(result.IndexedFields) != 1 || result.IndexedFields[0] != "message.level_name" || !result.FullTextIndex {
		t.Fatalf("index metadata = fields %#v, full text %v", result.IndexedFields, result.FullTextIndex)
	}
}

func TestAliyunIndexFieldsDistinguishesTextFieldsFromJSONLeaves(t *testing.T) {
	fake := &fakeAliyunClient{index: &sls.Index{Keys: map[string]sls.IndexKey{
		"message": {Type: "json", JsonKeys: map[string]*sls.JsonKey{
			"level_name": {Type: "text"},
			"ignored":    nil,
		}},
		"service": {Type: "text"},
	}}}

	fields, fullText := aliyunIndexFields(fake, "project-a", "access")
	if fullText || len(fields) != 2 || fields[0] != "message.level_name" || fields[1] != "service" {
		t.Fatalf("aliyunIndexFields() = %#v, %v", fields, fullText)
	}
}

func TestAliyunSLSQueryRewritesUnindexedFieldAsScanSPL(t *testing.T) {
	fake := &fakeAliyunClient{
		logs: &sls.GetLogsResponse{Count: 1, Logs: []map[string]string{{
			"__time__": "1783818000", "content": `{"type":"system"}`,
		}}},
		logsErrors: []error{&sls.Error{
			HTTPCode: 400, Code: "ParameterInvalid",
			Message: "key (content.type) is not config as key value config,if symbol : is in your log,please wrap : with quotation mark \"",
		}},
	}
	adapter := &aliyunSLSAdapter{newClient: func(context.Context, domain.ConnectionInput) (aliyunSLSClient, error) {
		return fake, nil
	}}
	result, err := adapter.Query(context.Background(), aliyunTestInput(), domain.QueryInput{
		Group: "project-a", Logstore: "access", Query: `* not content.type: business`,
		From: "2026-07-12T00:00:00Z", To: "2026-07-12T01:00:00Z", Page: 1, Limit: 20,
	})
	if err != nil {
		t.Fatalf("Query() error = %v", err)
	}
	want := "* | where json_extract_scalar(content, '$.type') is null or " +
		"json_extract_scalar(content, '$.type') != 'business'"
	if len(fake.logRequests) != 2 || fake.logRequests[1].Query != want || result.EffectiveQuery != want {
		t.Fatalf("scan requests = %#v, effective query = %q", fake.logRequests, result.EffectiveQuery)
	}
	if fake.histogramRequest != nil || len(result.Histogram) != 0 {
		t.Fatalf("scan query must not use index histogram: request %#v, result %#v", fake.histogramRequest, result.Histogram)
	}
}

func TestAliyunSLSRejectsInvalidRangeAndCancelledContext(t *testing.T) {
	adapter := &aliyunSLSAdapter{newClient: func(context.Context, domain.ConnectionInput) (aliyunSLSClient, error) {
		t.Fatal("SDK client must not be created")
		return nil, nil
	}}
	_, err := adapter.Query(context.Background(), aliyunTestInput(), domain.QueryInput{
		Logstore: "access", From: "2026-07-12T01:00:00Z", To: "2026-07-12T00:00:00Z",
	})
	if err == nil || !strings.Contains(err.Error(), "before") {
		t.Fatalf("invalid range error = %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = adapter.Connect(ctx, aliyunTestInput())
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled Connect() error = %v", err)
	}
}

func TestContextRoundTripperPropagatesCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	transport := contextRoundTripper{ctx: ctx, base: roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("base transport must not run after cancellation")
		return nil, nil
	})}
	request, _ := http.NewRequest(http.MethodGet, "https://example.com", nil)
	_, err := transport.RoundTrip(request)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("RoundTrip() error = %v", err)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestAliyunSLSConnectWrapsSDKError(t *testing.T) {
	fake := &fakeAliyunClient{listErr: io.EOF}
	adapter := &aliyunSLSAdapter{newClient: func(context.Context, domain.ConnectionInput) (aliyunSLSClient, error) { return fake, nil }}
	_, err := adapter.Connect(context.Background(), aliyunTestInput())
	if !errors.Is(err, io.EOF) || !strings.Contains(err.Error(), "list Alibaba Cloud SLS Logstores") {
		t.Fatalf("Connect() error = %v", err)
	}
}

func TestAliyunSLSAdapterIsReadyInDefaultRegistry(t *testing.T) {
	registered, ok := DefaultRegistry().Get("aliyun-sls")
	if !ok || !registered.Info().Ready {
		t.Fatalf("registered adapter = %#v, ok = %v", registered, ok)
	}
}

func TestAliyunLogTimeAcceptsRFC3339(t *testing.T) {
	want := time.Date(2026, 7, 12, 1, 2, 3, 0, time.UTC).Format(time.RFC3339Nano)
	if got := aliyunLogTime(map[string]string{"@timestamp": want}); got != want {
		t.Fatalf("aliyunLogTime() = %q, want %q", got, want)
	}
}

func TestNormalizeAliyunLogRetainsOriginalContentField(t *testing.T) {
	entry := normalizeAliyunLog(map[string]string{
		"__time__": "1783818000",
		"content":  `{"type":"business","message":"accepted"}`,
	})
	if entry.MessageField != "content" || entry.Message != `{"type":"business","message":"accepted"}` {
		t.Fatalf("normalized content entry = %#v", entry)
	}
}
