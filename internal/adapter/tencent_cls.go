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
	"sync"
	"time"

	cls "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/cls/v20201016"
	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common"
	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common/profile"

	"github.com/liangguifeng/LogGopher/internal/domain"
)

const (
	tencentRequestTimeoutSeconds = 30
	tencentTopicPageSize         = 100
)

// tencentCLSClient is the narrow portion of the official SDK required by the adapter.
type tencentCLSClient interface {
	DescribeTopicsWithContext(context.Context, *cls.DescribeTopicsRequest) (*cls.DescribeTopicsResponse, error)
	SearchLogWithContext(context.Context, *cls.SearchLogRequest) (*cls.SearchLogResponse, error)
}

// tencentClientFactory keeps SDK creation replaceable in unit tests.
type tencentClientFactory func(context.Context, domain.ConnectionInput) (tencentCLSClient, error)

// tencentCLSAdapter maps CLS Topics and search responses into the shared domain contract.
type tencentCLSAdapter struct {
	newClient tencentClientFactory
	mu        sync.RWMutex
	topics    map[string]map[string]string
}

// newTencentCLSAdapter creates the production Tencent Cloud CLS adapter.
func newTencentCLSAdapter() Adapter {
	return &tencentCLSAdapter{newClient: newTencentSDKClient, topics: make(map[string]map[string]string)}
}

// Info returns stable CLS metadata exposed to the connection screen.
func (a *tencentCLSAdapter) Info() domain.AdapterInfo {
	return domain.AdapterInfo{ID: "tencent-cls", Name: "腾讯云 CLS", Description: "Cloud Log Service", Ready: true}
}

// Connect validates credentials by listing every log Topic in the configured region.
func (a *tencentCLSAdapter) Connect(ctx context.Context, input domain.ConnectionInput) ([]string, error) {
	client, err := a.client(ctx, input)
	if err != nil {
		return nil, err
	}
	topics, err := describeAllTencentTopics(ctx, client)
	if err != nil {
		return nil, fmt.Errorf("list Tencent Cloud CLS Topics: %w", err)
	}
	labels, mapping := tencentTopicLabels(topics)
	a.mu.Lock()
	a.topics[tencentConnectionKey(input)] = mapping
	a.mu.Unlock()
	return labels, nil
}

// Query searches one CLS Topic and normalizes its result page.
func (a *tencentCLSAdapter) Query(
	ctx context.Context,
	input domain.ConnectionInput,
	query domain.QueryInput,
) (domain.QueryResult, error) {
	started := time.Now()
	from, to, err := parseTencentRange(query.From, query.To)
	if err != nil {
		return domain.QueryResult{}, err
	}
	client, err := a.client(ctx, input)
	if err != nil {
		return domain.QueryResult{}, err
	}
	topicID, ok := a.topicID(input, query.Logstore)
	if !ok {
		return domain.QueryResult{}, errors.New("Tencent Cloud CLS Topic mapping expired; reconnect first")
	}
	limit := query.Limit
	if limit <= 0 {
		limit = 100
	}
	if limit > 1000 {
		limit = 1000
	}
	page := query.Page
	if page < 1 {
		page = 1
	}
	expression := strings.TrimSpace(query.Query)
	response, err := client.SearchLogWithContext(ctx, newTencentSearchRequest(
		topicID, expression, from, to, int64(limit), uint64((page-1)*limit),
	))
	if err != nil {
		return domain.QueryResult{}, fmt.Errorf("query Tencent Cloud CLS logs: %w", err)
	}
	if response == nil || response.Response == nil {
		return domain.QueryResult{}, errors.New("query Tencent Cloud CLS logs: empty SDK response")
	}
	entries := normalizeTencentResults(response.Response.Results)
	total := (page-1)*limit + len(entries)
	if count, countErr := countTencentLogs(ctx, client, topicID, expression, from, to); countErr == nil {
		total = count
	} else if response.Response.ListOver != nil && !*response.Response.ListOver {
		total++
	}
	return domain.QueryResult{
		TookMS: time.Since(started).Milliseconds(), Total: total, Entries: entries,
	}, nil
}

// client validates CLS metadata before constructing a request-scoped SDK client.
func (a *tencentCLSAdapter) client(ctx context.Context, input domain.ConnectionInput) (tencentCLSClient, error) {
	if err := validateTencentInput(input); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return a.newClient(ctx, input)
}

// topicID resolves the UI label cached during Connect into the provider Topic ID.
func (a *tencentCLSAdapter) topicID(input domain.ConnectionInput, label string) (string, bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	topicID, ok := a.topics[tencentConnectionKey(input)][label]
	return topicID, ok
}

// newTencentSDKClient configures the official API 3.0 client with a bounded timeout.
func newTencentSDKClient(_ context.Context, input domain.ConnectionInput) (tencentCLSClient, error) {
	endpoint, err := url.ParseRequestURI(strings.TrimSpace(input.Endpoint))
	if err != nil {
		return nil, errors.New("Tencent Cloud CLS endpoint must be a valid HTTP(S) URL")
	}
	httpProfile := profile.NewHttpProfile()
	httpProfile.Endpoint = endpoint.Host
	httpProfile.Scheme = strings.ToUpper(endpoint.Scheme)
	httpProfile.ReqTimeout = tencentRequestTimeoutSeconds
	clientProfile := profile.NewClientProfile()
	clientProfile.HttpProfile = httpProfile
	return cls.NewClient(
		common.NewCredential(input.AccessKey, input.SecretKey),
		strings.TrimSpace(input.Region),
		clientProfile,
	)
}

// validateTencentInput rejects incomplete or unsafe CLS connection settings.
func validateTencentInput(input domain.ConnectionInput) error {
	if strings.TrimSpace(input.AccessKey) == "" ||
		strings.TrimSpace(input.SecretKey) == "" ||
		strings.TrimSpace(input.Region) == "" {
		return errors.New("Tencent Cloud CLS requires SecretId, SecretKey and region")
	}
	endpoint, err := url.ParseRequestURI(strings.TrimSpace(input.Endpoint))
	if err != nil || (endpoint.Scheme != "https" && endpoint.Scheme != "http") || endpoint.Host == "" {
		return errors.New("Tencent Cloud CLS endpoint must be a valid HTTP(S) URL")
	}
	if endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" ||
		(endpoint.Path != "" && endpoint.Path != "/") {
		return errors.New("Tencent Cloud CLS endpoint must not contain credentials, a path, query, or fragment")
	}
	return nil
}

// describeAllTencentTopics follows DescribeTopics offset pagination until all Topics are loaded.
func describeAllTencentTopics(ctx context.Context, client tencentCLSClient) ([]*cls.TopicInfo, error) {
	topics := make([]*cls.TopicInfo, 0)
	for offset := int64(0); ; offset += tencentTopicPageSize {
		request := cls.NewDescribeTopicsRequest()
		request.Offset = int64Pointer(offset)
		request.Limit = int64Pointer(tencentTopicPageSize)
		request.BizType = uint64Pointer(0)
		response, err := client.DescribeTopicsWithContext(ctx, request)
		if err != nil {
			return nil, err
		}
		if response == nil || response.Response == nil {
			return nil, errors.New("empty DescribeTopics response")
		}
		topics = append(topics, response.Response.Topics...)
		total := int64(len(topics))
		if response.Response.TotalCount != nil {
			total = *response.Response.TotalCount
		}
		if int64(len(topics)) >= total || len(response.Response.Topics) == 0 {
			return topics, nil
		}
	}
}

// tencentTopicLabels creates unique human-readable labels and their Topic ID mapping.
func tencentTopicLabels(topics []*cls.TopicInfo) ([]string, map[string]string) {
	nameCounts := make(map[string]int)
	for _, topic := range topics {
		if topic != nil && topic.TopicName != nil {
			nameCounts[*topic.TopicName]++
		}
	}
	mapping := make(map[string]string, len(topics))
	labels := make([]string, 0, len(topics))
	for _, topic := range topics {
		if topic == nil || topic.TopicId == nil || strings.TrimSpace(*topic.TopicId) == "" {
			continue
		}
		name := strings.TrimSpace(stringValue(topic.TopicName))
		if name == "" {
			name = *topic.TopicId
		}
		label := name
		if nameCounts[name] > 1 {
			label = fmt.Sprintf("%s · %s", name, shortTencentTopicID(*topic.TopicId))
		}
		mapping[label] = *topic.TopicId
		labels = append(labels, label)
	}
	sort.Strings(labels)
	return labels, mapping
}

// newTencentSearchRequest builds a CQL raw-log request with offset pagination.
func newTencentSearchRequest(
	topicID, expression string,
	from, to time.Time,
	limit int64,
	offset uint64,
) *cls.SearchLogRequest {
	request := cls.NewSearchLogRequest()
	request.From = int64Pointer(from.UnixMilli())
	request.To = int64Pointer(to.UnixMilli())
	request.QueryString = stringPointer(expression)
	request.QuerySyntax = uint64Pointer(1)
	request.TopicId = stringPointer(topicID)
	request.Sort = stringPointer("desc")
	request.Limit = int64Pointer(limit)
	request.Offset = uint64Pointer(offset)
	request.SamplingRate = float64Pointer(1)
	request.UseNewAnalysis = boolPointer(true)
	return request
}

// countTencentLogs executes an exact SQL count using the same CQL search condition.
func countTencentLogs(
	ctx context.Context,
	client tencentCLSClient,
	topicID, expression string,
	from, to time.Time,
) (int, error) {
	search, _, _ := strings.Cut(expression, "|")
	search = strings.TrimSpace(search)
	if search == "" {
		search = "*"
	}
	request := newTencentSearchRequest(topicID, search+" | SELECT count(*) AS loggopher_total", from, to, 1, 0)
	response, err := client.SearchLogWithContext(ctx, request)
	if err != nil {
		return 0, err
	}
	if response == nil || response.Response == nil {
		return 0, errors.New("empty CLS count response")
	}
	for _, raw := range response.Response.AnalysisRecords {
		if raw == nil {
			continue
		}
		var record map[string]any
		if json.Unmarshal([]byte(*raw), &record) != nil {
			continue
		}
		if count, ok := integerValue(record["loggopher_total"]); ok {
			return count, nil
		}
	}
	return 0, errors.New("CLS count response does not contain loggopher_total")
}

// normalizeTencentResults converts provider log metadata and LogJson into shared entries.
func normalizeTencentResults(results []*cls.LogInfo) []domain.LogEntry {
	entries := make([]domain.LogEntry, 0, len(results))
	for _, result := range results {
		if result != nil {
			entries = append(entries, normalizeTencentLog(result))
		}
	}
	return entries
}

// normalizeTencentLog extracts common display fields while preserving all remaining CLS fields.
func normalizeTencentLog(log *cls.LogInfo) domain.LogEntry {
	fields := make(map[string]string)
	var decoded map[string]any
	if log.LogJson != nil {
		_ = json.Unmarshal([]byte(*log.LogJson), &decoded)
	}
	for key, value := range decoded {
		fields[key] = stringifyTencentValue(value)
	}
	addTencentMetadata(fields, "__source__", log.Source)
	addTencentMetadata(fields, "__filename__", log.FileName)
	addTencentMetadata(fields, "__topic__", log.TopicName)
	addTencentMetadata(fields, "__hostname__", log.HostName)
	levelKey, level := caseInsensitiveTencentField(fields, "level", "log_level", "severity", "severity_text")
	messageKey, message := caseInsensitiveTencentField(fields, "message", "msg", "content", "body", "__CONTENT__")
	delete(fields, levelKey)
	delete(fields, messageKey)
	if level == "" {
		level = "UNKNOWN"
	}
	if message == "" {
		if log.RawLog != nil && *log.RawLog != "" {
			message = *log.RawLog
		} else if log.LogJson != nil {
			message = *log.LogJson
		}
	}
	timestamp := ""
	if log.Time != nil {
		timestamp = time.UnixMilli(*log.Time).UTC().Format(time.RFC3339Nano)
	}
	return domain.LogEntry{Time: timestamp, Level: strings.ToUpper(level), Message: message, Fields: fields}
}

func parseTencentRange(fromValue, toValue string) (time.Time, time.Time, error) {
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

func tencentConnectionKey(input domain.ConnectionInput) string {
	return strings.Join([]string{input.Name, input.Endpoint, input.Region}, "\x00")
}

func shortTencentTopicID(topicID string) string {
	if len(topicID) <= 8 {
		return topicID
	}
	return topicID[:8]
}

func stringifyTencentValue(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprint(value)
	}
	return string(encoded)
}

func caseInsensitiveTencentField(fields map[string]string, candidates ...string) (string, string) {
	for _, candidate := range candidates {
		for key, value := range fields {
			if strings.EqualFold(key, candidate) {
				return key, value
			}
		}
	}
	return "", ""
}

func addTencentMetadata(fields map[string]string, key string, value *string) {
	if value != nil && *value != "" {
		fields[key] = *value
	}
}

func integerValue(value any) (int, bool) {
	switch typed := value.(type) {
	case float64:
		return int(typed), true
	case string:
		parsed, err := strconv.Atoi(typed)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func stringPointer(value string) *string    { return &value }
func int64Pointer(value int64) *int64       { return &value }
func uint64Pointer(value uint64) *uint64    { return &value }
func float64Pointer(value float64) *float64 { return &value }
func boolPointer(value bool) *bool          { return &value }
