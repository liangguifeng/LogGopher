package adapter

import (
	"context"
	"errors"
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
	logstores        []string
	listErr          error
	logs             *sls.GetLogsResponse
	logsErr          error
	logsErrors       []error
	histogram        *sls.GetHistogramsResponse
	histogramErr     error
	logRequest       *sls.GetLogRequest
	logRequests      []*sls.GetLogRequest
	histogramRequest *sls.GetHistogramRequest
	project          string
	logstore         string
}

func (client *fakeAliyunClient) ListLogStore(project string) ([]string, error) {
	client.project = project
	return client.logstores, client.listErr
}

func (client *fakeAliyunClient) GetLogsToCompletedV2(project, logstore string, request *sls.GetLogRequest) (*sls.GetLogsResponse, error) {
	client.project, client.logstore, client.logRequest = project, logstore, request
	requestCopy := *request
	client.logRequests = append(client.logRequests, &requestCopy)
	if len(client.logsErrors) >= len(client.logRequests) {
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
		AccessKey: "test-ak", SecretKey: "test-sk", Project: "project-a",
	}
}

func TestAliyunSLSConnectListsLogstores(t *testing.T) {
	fake := &fakeAliyunClient{logstores: []string{"access", "application"}}
	adapter := &aliyunSLSAdapter{newClient: func(context.Context, domain.ConnectionInput) (aliyunSLSClient, error) { return fake, nil }}

	logstores, err := adapter.Connect(context.Background(), aliyunTestInput())
	if err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	if fake.project != "project-a" || len(logstores) != 2 || logstores[0] != "access" {
		t.Fatalf("Connect() = %#v, project = %q", logstores, fake.project)
	}
}

func TestAliyunSLSQueryMapsPaginationAndNormalizesLogs(t *testing.T) {
	fake := &fakeAliyunClient{
		logs: &sls.GetLogsResponse{Count: 1, Logs: []map[string]string{{
			"__time__": "1783818000", "__time_ns_part__": "123000000", "LEVEL": "warn",
			"message": "upstream slow", "service": "gateway", "status": "429",
		}}},
		histogram: &sls.GetHistogramsResponse{Count: 47},
	}
	adapter := &aliyunSLSAdapter{newClient: func(context.Context, domain.ConnectionInput) (aliyunSLSClient, error) { return fake, nil }}
	result, err := adapter.Query(context.Background(), aliyunTestInput(), domain.QueryInput{
		Logstore: "access", Query: " status:429 | select count(*) ",
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
	if result.Total != 47 || len(result.Entries) != 1 {
		t.Fatalf("Query() = %#v", result)
	}
	entry := result.Entries[0]
	if entry.Level != "WARN" || entry.Message != "upstream slow" || entry.Fields["service"] != "gateway" {
		t.Fatalf("normalized entry = %#v", entry)
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
		Logstore: "access", From: "2026-07-12T00:00:00Z", To: "2026-07-12T01:00:00Z", Page: 1, Limit: 500,
	})
	if err != nil {
		t.Fatalf("Query() error = %v", err)
	}
	if fake.logRequest.Query != "*" || fake.logRequest.Lines != 100 {
		t.Fatalf("GetLogs request = %#v", fake.logRequest)
	}
}

func TestAliyunSLSQueryFallsBackForUnindexedFilter(t *testing.T) {
	fake := &fakeAliyunClient{
		logs: &sls.GetLogsResponse{Logs: []map[string]string{{
			"__time__": "1783818000", "message": "request accepted",
		}}},
		logsErrors: []error{&sls.Error{
			HTTPCode: 400, Code: "ParameterInvalid",
			Message: "key (request) is not config as key value config,if symbol : is in your log,please wrap : with quotation mark \"",
		}},
		histogram: &sls.GetHistogramsResponse{Count: 1},
	}
	adapter := &aliyunSLSAdapter{newClient: func(context.Context, domain.ConnectionInput) (aliyunSLSClient, error) {
		return fake, nil
	}}
	_, err := adapter.Query(context.Background(), aliyunTestInput(), domain.QueryInput{
		Logstore: "access", Query: `service:"gateway" AND request:"POST /orders:submit"`,
		From: "2026-07-12T00:00:00Z", To: "2026-07-12T01:00:00Z", Page: 1, Limit: 20,
	})
	if err != nil {
		t.Fatalf("Query() error = %v", err)
	}
	if len(fake.logRequests) != 2 {
		t.Fatalf("GetLogs calls = %d, want 2", len(fake.logRequests))
	}
	if got := fake.logRequests[1].Query; got != `service:"gateway" AND "POST /orders:submit"` {
		t.Fatalf("fallback query = %q", got)
	}
	if got := fake.histogramRequest.Query; got != `service:"gateway" AND "POST /orders:submit"` {
		t.Fatalf("histogram query = %q", got)
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
