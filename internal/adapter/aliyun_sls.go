package adapter

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	sls "github.com/aliyun/aliyun-log-go-sdk"
	"github.com/liangguifeng/LogGopher/internal/domain"
)

const aliyunRequestTimeout = 30 * time.Second

// aliyunSLSClient is the narrow portion of the vendor SDK used by this adapter.
type aliyunSLSClient interface {
	ListProjectV2(offset, size int) ([]sls.LogProject, int, int, error)
	ListLogStore(project string) ([]string, error)
	GetIndex(project, logstore string) (*sls.Index, error)
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

// Connect discovers accessible Projects and their Logstores through the official SLS API.
func (a *aliyunSLSAdapter) Connect(ctx context.Context, input domain.ConnectionInput) ([]domain.LogGroup, error) {
	client, err := a.client(ctx, input)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	projects, err := listAllAliyunProjects(ctx, client)
	if err != nil {
		return nil, fmt.Errorf("list Alibaba Cloud SLS Projects: %w", err)
	}
	groups := make([]domain.LogGroup, 0, len(projects))
	for _, project := range projects {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		logstores, err := client.ListLogStore(project)
		if err != nil {
			return nil, fmt.Errorf("list Alibaba Cloud SLS Logstores for project %q: %w", project, err)
		}
		sort.Strings(logstores)
		groups = append(groups, domain.LogGroup{Name: project, Logstores: logstores})
	}
	return groups, nil
}

// listAllAliyunProjects follows SLS offset pagination and returns a stable sorted list.
func listAllAliyunProjects(ctx context.Context, client aliyunSLSClient) ([]string, error) {
	const pageSize = 500
	projects := make([]string, 0)
	for offset := 0; ; offset += pageSize {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		page, count, total, err := client.ListProjectV2(offset, pageSize)
		if err != nil {
			return nil, err
		}
		for _, project := range page {
			if name := strings.TrimSpace(project.Name); name != "" {
				projects = append(projects, name)
			}
		}
		if count == 0 || offset+count >= total {
			break
		}
	}
	sort.Strings(projects)
	return projects, nil
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
	project := strings.TrimSpace(query.Group)
	if project == "" {
		return domain.QueryResult{}, errors.New("Alibaba Cloud SLS project is required for querying")
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
	response, effectiveExpression, err := queryAliyunLogs(
		ctx, client, project, query.Logstore, &sls.GetLogRequest{
			From: from.Unix(), To: to.Unix(), Query: expression,
			Lines: int64(limit), Offset: int64((page - 1) * limit), Reverse: true,
			IsAccurate: &accurate,
		},
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
	buckets := make([]domain.HistogramBucket, 0)
	if !aliyunUsesSPL(effectiveExpression) {
		histogram, histogramErr := client.GetHistogramsToCompletedV2(
			project,
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
			buckets = normalizeAliyunHistogram(histogram.Histograms)
		} else if response.Count == int64(limit) {
			// Preserve a usable next page when histogram permission or indexing is unavailable.
			total = (page * limit) + 1
		}
	}
	indexedFields, fullTextIndex := aliyunIndexFields(client, project, query.Logstore)

	entries := make([]domain.LogEntry, 0, len(response.Logs))
	for _, log := range response.Logs {
		entries = append(entries, normalizeAliyunLog(log))
	}
	return domain.QueryResult{
		TookMS: time.Since(started).Milliseconds(), Total: total,
		Entries: entries, Histogram: buckets,
		IndexedFields: indexedFields, FullTextIndex: fullTextIndex,
		EffectiveQuery: effectiveExpression,
	}, nil
}

// aliyunIndexFields returns only provider-declared field indexes for query assistance.
func aliyunIndexFields(client aliyunSLSClient, project, logstore string) ([]string, bool) {
	index, err := client.GetIndex(project, logstore)
	if err != nil || index == nil {
		return []string{}, false
	}
	fields := make([]string, 0, len(index.Keys))
	for field, key := range index.Keys {
		if strings.EqualFold(key.Type, "json") {
			// A JSON container is not itself a queryable leaf. SLS only accepts
			// Key:Value for its configured JSON leaf paths.
			for child, childIndex := range key.JsonKeys {
				if childIndex != nil {
					fields = append(fields, field+"."+child)
				}
			}
			continue
		}
		fields = append(fields, field)
	}
	sort.Strings(fields)
	return fields, index.Line != nil
}

// normalizeAliyunHistogram preserves the provider's exact bucket boundaries and counts.
func normalizeAliyunHistogram(histograms []sls.SingleHistogram) []domain.HistogramBucket {
	buckets := make([]domain.HistogramBucket, 0, len(histograms))
	for _, histogram := range histograms {
		buckets = append(buckets, domain.HistogramBucket{
			From:  time.Unix(histogram.From, 0).UTC().Format(time.RFC3339Nano),
			To:    time.Unix(histogram.To, 0).UTC().Format(time.RFC3339Nano),
			Count: histogram.Count,
		})
	}
	return buckets
}

// queryAliyunLogs converts SLS-rejected field clauses into console-style full-text terms.
func queryAliyunLogs(
	ctx context.Context,
	client aliyunSLSClient,
	project, logstore string,
	request *sls.GetLogRequest,
) (*sls.GetLogsResponse, string, error) {
	effectiveExpression := request.Query
	for attempt := 0; attempt <= aliyunQueryRewriteLimit; attempt++ {
		request.Query = effectiveExpression
		response, err := client.GetLogsToCompletedV2(project, logstore, request)
		if err == nil {
			return response, effectiveExpression, nil
		}
		if contextErr := ctx.Err(); contextErr != nil {
			return nil, effectiveExpression, contextErr
		}
		field, ok := aliyunUnindexedKey(err)
		if !ok {
			return nil, effectiveExpression, err
		}
		next, rewritten := rewriteAliyunUnindexedFilterAsFullText(effectiveExpression, field)
		if !rewritten || next == effectiveExpression {
			return nil, effectiveExpression, err
		}
		effectiveExpression = next
	}
	return nil, effectiveExpression, errors.New("too many unindexed Alibaba Cloud SLS filter fields")
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

// validateAliyunInput rejects incomplete or structurally invalid SLS connection settings.
func validateAliyunInput(input domain.ConnectionInput) error {
	if strings.TrimSpace(input.AccessKey) == "" || strings.TrimSpace(input.SecretKey) == "" {
		return errors.New("Alibaba Cloud SLS requires AK and SK")
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
	level = resolveLogLevel(level, message, log)
	if message == "" {
		encoded, _ := json.Marshal(log)
		message = string(encoded)
	}
	return domain.LogEntry{
		Time: timestamp, Level: level, Message: message,
		MessageField: messageKey, Fields: fields,
	}
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
