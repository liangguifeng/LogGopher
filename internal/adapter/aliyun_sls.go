package adapter

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	sls "github.com/aliyun/aliyun-log-go-sdk"
	"github.com/liangguifeng/LogGopher/internal/domain"
)

const aliyunRequestTimeout = 30 * time.Second
const aliyunQueryFallbackLimit = 8

var aliyunUnindexedKeyPattern = regexp.MustCompile(`(?i)key \(([^)]+)\) is not config as key value config`)

// aliyunSLSClient is the narrow portion of the vendor SDK used by this adapter.
type aliyunSLSClient interface {
	ListLogStore(project string) ([]string, error)
	GetLogsToCompletedV2(project, logstore string, request *sls.GetLogRequest) (*sls.GetLogsResponse, error)
	GetHistogramsToCompletedV2(
		project, logstore string,
		request *sls.GetHistogramRequest,
	) (*sls.GetHistogramsResponse, error)
}

// aliyunClientFactory keeps SDK construction replaceable in unit tests.
type aliyunClientFactory func(context.Context, domain.ConnectionInput) (aliyunSLSClient, error)

// aliyunSLSAdapter maps the official Alibaba Cloud SDK into the shared domain contract.
type aliyunSLSAdapter struct{ newClient aliyunClientFactory }

// newAliyunSLSAdapter creates the production SLS adapter.
func newAliyunSLSAdapter() Adapter {
	return &aliyunSLSAdapter{newClient: newAliyunSDKClient}
}

// Info returns stable SLS metadata exposed to the connection screen.
func (a *aliyunSLSAdapter) Info() domain.AdapterInfo {
	return domain.AdapterInfo{
		ID: "aliyun-sls", Name: "阿里云 SLS",
		Description: "Simple Log Service", Ready: true,
	}
}

// Connect validates the credentials and returns every Logstore in the configured Project.
func (a *aliyunSLSAdapter) Connect(ctx context.Context, input domain.ConnectionInput) ([]string, error) {
	client, err := a.client(ctx, input)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	logstores, err := client.ListLogStore(strings.TrimSpace(input.Project))
	if err != nil {
		return nil, fmt.Errorf("list Alibaba Cloud SLS Logstores: %w", err)
	}
	return logstores, nil
}

// Query executes an SLS search and normalizes its page into provider-neutral log entries.
func (a *aliyunSLSAdapter) Query(
	ctx context.Context,
	input domain.ConnectionInput,
	query domain.QueryInput,
) (domain.QueryResult, error) {
	started := time.Now()
	from, to, err := parseAliyunRange(query.From, query.To)
	if err != nil {
		return domain.QueryResult{}, err
	}
	client, err := a.client(ctx, input)
	if err != nil {
		return domain.QueryResult{}, err
	}
	limit := query.Limit
	if limit <= 0 {
		limit = 100
	}
	if limit > 100 {
		limit = 100
	}
	page := query.Page
	if page < 1 {
		page = 1
	}
	expression := strings.TrimSpace(query.Query)
	if expression == "" {
		expression = "*"
	}
	accurate := true
	request := &sls.GetLogRequest{
		From: from.Unix(), To: to.Unix(), Query: expression,
		Lines: int64(limit), Offset: int64((page - 1) * limit), Reverse: true,
		IsAccurate: &accurate,
	}
	response, effectiveExpression, err := queryAliyunLogs(
		ctx, client, strings.TrimSpace(input.Project), query.Logstore, request,
	)
	if err != nil {
		return domain.QueryResult{}, fmt.Errorf("query Alibaba Cloud SLS logs: %w", err)
	}
	if response == nil {
		return domain.QueryResult{}, errors.New("query Alibaba Cloud SLS logs: empty SDK response")
	}
	if err := ctx.Err(); err != nil {
		return domain.QueryResult{}, err
	}

	total := int(response.Count)
	histogram, histogramErr := client.GetHistogramsToCompletedV2(
		strings.TrimSpace(input.Project),
		query.Logstore,
		&sls.GetHistogramRequest{
			From: from.Unix(), To: to.Unix(), Query: aliyunSearchExpression(effectiveExpression),
		},
	)
	if err := ctx.Err(); err != nil {
		return domain.QueryResult{}, err
	}
	if histogramErr == nil && histogram != nil {
		total = int(histogram.Count)
	} else if response.Count == int64(limit) {
		// Preserve a usable next page when histogram permission or indexing is unavailable.
		total = (page * limit) + 1
	}

	entries := make([]domain.LogEntry, 0, len(response.Logs))
	for _, log := range response.Logs {
		entries = append(entries, normalizeAliyunLog(log))
	}
	return domain.QueryResult{
		TookMS: time.Since(started).Milliseconds(), Total: total, Entries: entries,
	}, nil
}

// queryAliyunLogs retries UI-generated filters as full-text phrases when SLS reports an unindexed key.
func queryAliyunLogs(
	ctx context.Context,
	client aliyunSLSClient,
	project, logstore string,
	request *sls.GetLogRequest,
) (*sls.GetLogsResponse, string, error) {
	effectiveExpression := request.Query
	for attempt := 0; attempt <= aliyunQueryFallbackLimit; attempt++ {
		request.Query = effectiveExpression
		response, err := client.GetLogsToCompletedV2(project, logstore, request)
		if err == nil {
			return response, effectiveExpression, nil
		}
		if contextErr := ctx.Err(); contextErr != nil {
			return nil, effectiveExpression, contextErr
		}
		key, ok := aliyunUnindexedKey(err)
		if !ok {
			return nil, effectiveExpression, err
		}
		next, rewritten := rewriteAliyunUnindexedFilter(effectiveExpression, key)
		if !rewritten || next == effectiveExpression {
			return nil, effectiveExpression, err
		}
		effectiveExpression = next
	}
	return nil, effectiveExpression, errors.New("too many unindexed Alibaba Cloud SLS filter fields")
}

// aliyunUnindexedKey extracts the field named by SLS in a ParameterInvalid response.
func aliyunUnindexedKey(err error) (string, bool) {
	var sdkError *sls.Error
	if !errors.As(err, &sdkError) || sdkError.Code != "ParameterInvalid" {
		return "", false
	}
	match := aliyunUnindexedKeyPattern.FindStringSubmatch(sdkError.Message)
	if len(match) != 2 || strings.TrimSpace(match[1]) == "" {
		return "", false
	}
	return strings.TrimSpace(match[1]), true
}

// rewriteAliyunUnindexedFilter changes key:value into a value-only phrase for the reported key.
func rewriteAliyunUnindexedFilter(expression, key string) (string, bool) {
	quotedKey := regexp.QuoteMeta(key)
	clause := regexp.MustCompile(
		`(?i)(^|\s+AND\s+)(NOT\s+)?(?:"` + quotedKey + `"|` + quotedKey + `)\s*:\s*("(?:\\.|[^"])*"|[^\s|)]+)`,
	)
	rewritten := false
	result := clause.ReplaceAllStringFunc(expression, func(raw string) string {
		parts := clause.FindStringSubmatch(raw)
		if len(parts) != 4 {
			return raw
		}
		rewritten = true
		return parts[1] + parts[2] + parts[3]
	})
	return result, rewritten
}

// client validates the connection metadata before constructing a request-scoped SDK client.
func (a *aliyunSLSAdapter) client(ctx context.Context, input domain.ConnectionInput) (aliyunSLSClient, error) {
	if err := validateAliyunInput(input); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return a.newClient(ctx, input)
}

// newAliyunSDKClient configures credentials, cancellation, and bounded retries on the official SDK.
func newAliyunSDKClient(ctx context.Context, input domain.ConnectionInput) (aliyunSLSClient, error) {
	provider := sls.NewStaticCredentialsProvider(input.AccessKey, input.SecretKey, "")
	client := sls.CreateNormalInterfaceV2(strings.TrimSpace(input.Endpoint), provider)
	client.SetHTTPClient(&http.Client{
		Transport: contextRoundTripper{ctx: ctx, base: http.DefaultTransport},
		Timeout:   aliyunRequestTimeout,
	})
	client.SetRetryTimeout(aliyunRequestTimeout)
	return client, nil
}

// contextRoundTripper binds SDK requests to the Wails lifecycle context.
type contextRoundTripper struct {
	ctx  context.Context
	base http.RoundTripper
}

// RoundTrip forwards a cloned request that is cancelled with the adapter operation.
func (transport contextRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	if err := transport.ctx.Err(); err != nil {
		return nil, err
	}
	return transport.base.RoundTrip(request.Clone(transport.ctx))
}

// validateAliyunInput rejects incomplete or structurally invalid SLS connection settings.
func validateAliyunInput(input domain.ConnectionInput) error {
	if strings.TrimSpace(input.AccessKey) == "" ||
		strings.TrimSpace(input.SecretKey) == "" ||
		strings.TrimSpace(input.Project) == "" {
		return errors.New("Alibaba Cloud SLS requires AK, SK and project")
	}
	endpoint, err := url.ParseRequestURI(strings.TrimSpace(input.Endpoint))
	if err != nil || (endpoint.Scheme != "https" && endpoint.Scheme != "http") || endpoint.Host == "" {
		return errors.New("Alibaba Cloud SLS endpoint must be a valid HTTP(S) URL")
	}
	if endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" ||
		(endpoint.Path != "" && endpoint.Path != "/") {
		return errors.New("Alibaba Cloud SLS endpoint must not contain credentials, a path, query, or fragment")
	}
	return nil
}

// parseAliyunRange converts the shared RFC3339 range into the SDK's Unix-second interval.
func parseAliyunRange(fromValue, toValue string) (time.Time, time.Time, error) {
	from, err := time.Parse(time.RFC3339, fromValue)
	if err != nil {
		return time.Time{}, time.Time{}, errors.New("query start time must be RFC3339")
	}
	to, err := time.Parse(time.RFC3339, toValue)
	if err != nil {
		return time.Time{}, time.Time{}, errors.New("query end time must be RFC3339")
	}
	if !from.Before(to) {
		return time.Time{}, time.Time{}, errors.New("query start time must be before end time")
	}
	return from, to, nil
}

// aliyunSearchExpression removes the analytic pipeline unsupported by GetHistograms.
func aliyunSearchExpression(expression string) string {
	search, _, _ := strings.Cut(expression, "|")
	search = strings.TrimSpace(search)
	if search == "" {
		return "*"
	}
	return search
}

// normalizeAliyunLog extracts common display fields while retaining vendor fields for inspection.
func normalizeAliyunLog(log map[string]string) domain.LogEntry {
	fields := make(map[string]string, len(log))
	for key, value := range log {
		fields[key] = value
	}
	timestamp := aliyunLogTime(log)
	levelKey, level := aliyunField(log, "level", "log_level", "severity", "severity_text")
	messageKey, message := aliyunField(log, "message", "msg", "content", "body")
	delete(fields, "__time__")
	delete(fields, "__time_ns_part__")
	if levelKey != "" {
		delete(fields, levelKey)
	}
	if messageKey != "" {
		delete(fields, messageKey)
	}
	if level == "" {
		level = "UNKNOWN"
	}
	if message == "" {
		encoded, _ := json.Marshal(log)
		message = string(encoded)
	}
	return domain.LogEntry{Time: timestamp, Level: strings.ToUpper(level), Message: message, Fields: fields}
}

// aliyunLogTime maps SLS system time fields into RFC3339Nano.
func aliyunLogTime(log map[string]string) string {
	raw := log["__time__"]
	if seconds, err := strconv.ParseInt(raw, 10, 64); err == nil {
		nanoseconds, _ := strconv.ParseInt(log["__time_ns_part__"], 10, 64)
		return time.Unix(seconds, nanoseconds).UTC().Format(time.RFC3339Nano)
	}
	for _, candidate := range []string{raw, log["@timestamp"], log["timestamp"], log["time"]} {
		if parsed, err := time.Parse(time.RFC3339Nano, candidate); err == nil {
			return parsed.UTC().Format(time.RFC3339Nano)
		}
	}
	return ""
}

// aliyunField performs a case-insensitive lookup and returns the original field key.
func aliyunField(log map[string]string, candidates ...string) (string, string) {
	for _, candidate := range candidates {
		for key, value := range log {
			if strings.EqualFold(key, candidate) {
				return key, value
			}
		}
	}
	return "", ""
}
