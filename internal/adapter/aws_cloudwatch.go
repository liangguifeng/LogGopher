package adapter

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatchlogs"
	awstypes "github.com/aws/aws-sdk-go-v2/service/cloudwatchlogs/types"
	"github.com/liangguifeng/LogGopher/internal/domain"
)

const awsRequestTimeout = 30 * time.Second

// awsCloudWatchClient is the SDK surface required by the adapter.
type awsCloudWatchClient interface {
	DescribeLogGroups(context.Context, *cloudwatchlogs.DescribeLogGroupsInput, ...func(*cloudwatchlogs.Options)) (*cloudwatchlogs.DescribeLogGroupsOutput, error)
	FilterLogEvents(context.Context, *cloudwatchlogs.FilterLogEventsInput, ...func(*cloudwatchlogs.Options)) (*cloudwatchlogs.FilterLogEventsOutput, error)
}

type awsClientFactory func(context.Context, domain.ConnectionInput) (awsCloudWatchClient, error)

// awsCloudWatchAdapter maps CloudWatch Log Groups into the shared logstore contract.
type awsCloudWatchAdapter struct{ newClient awsClientFactory }

func newAWSCloudWatchAdapter() Adapter {
	return &awsCloudWatchAdapter{newClient: newAWSCloudWatchSDKClient}
}

func (a *awsCloudWatchAdapter) Info() domain.AdapterInfo {
	return domain.AdapterInfo{
		ID: "aws-cloudwatch", Name: "AWS CloudWatch", Description: "CloudWatch Logs", Ready: true,
	}
}

// Connect validates credentials by listing every Log Group in the configured Region.
func (a *awsCloudWatchAdapter) Connect(ctx context.Context, input domain.ConnectionInput) ([]domain.LogGroup, error) {
	client, err := a.client(ctx, input)
	if err != nil {
		return nil, err
	}
	logGroups, err := describeAllAWSLogGroups(ctx, client)
	if err != nil {
		return nil, fmt.Errorf("list AWS CloudWatch Log Groups: %w", err)
	}
	return []domain.LogGroup{{Name: strings.TrimSpace(input.Region), Logstores: logGroups}}, nil
}

// Query retrieves one logical page using the provider's continuation token chain.
func (a *awsCloudWatchAdapter) Query(
	ctx context.Context,
	input domain.ConnectionInput,
	query domain.QueryInput,
) (domain.QueryResult, error) {
	started := time.Now()
	from, to, err := parseAWSRange(query.From, query.To)
	if err != nil {
		return domain.QueryResult{}, err
	}
	client, err := a.client(ctx, input)
	if err != nil {
		return domain.QueryResult{}, err
	}
	page := max(query.Page, 1)
	limit := query.Limit
	if limit <= 0 {
		limit = 100
	}
	limit = min(limit, 10_000)

	var token *string
	seen := 0
	var output *cloudwatchlogs.FilterLogEventsOutput
	for currentPage := 1; currentPage <= page; currentPage++ {
		request := &cloudwatchlogs.FilterLogEventsInput{
			LogGroupName: aws.String(query.Logstore), StartTime: aws.Int64(from.UnixMilli()),
			EndTime: aws.Int64(to.UnixMilli()), Limit: aws.Int32(int32(limit)),
			NextToken: token, StartFromHead: aws.Bool(false),
		}
		if pattern := rewriteSemanticLevelFilters(strings.TrimSpace(query.Query)); pattern != "" {
			request.FilterPattern = aws.String(pattern)
		}
		output, err = client.FilterLogEvents(ctx, request)
		if err != nil {
			return domain.QueryResult{}, fmt.Errorf("query AWS CloudWatch Logs: %w", err)
		}
		if output == nil {
			return domain.QueryResult{}, errors.New("query AWS CloudWatch Logs: empty SDK response")
		}
		if currentPage < page {
			seen += len(output.Events)
			if output.NextToken == nil || sameStringPointer(token, output.NextToken) {
				return domain.QueryResult{TookMS: time.Since(started).Milliseconds(), Total: seen}, nil
			}
			token = output.NextToken
		}
	}

	entries := make([]domain.LogEntry, 0, len(output.Events))
	for _, event := range output.Events {
		entries = append(entries, normalizeAWSEvent(event))
	}
	total := seen + len(entries)
	if output.NextToken != nil && !sameStringPointer(token, output.NextToken) {
		total = max(total, page*limit+1)
	}
	return domain.QueryResult{
		TookMS: time.Since(started).Milliseconds(), Total: total,
		Entries: entries, Histogram: []domain.HistogramBucket{},
	}, nil
}

func (a *awsCloudWatchAdapter) client(ctx context.Context, input domain.ConnectionInput) (awsCloudWatchClient, error) {
	if err := validateAWSInput(input); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return a.newClient(ctx, input)
}

func newAWSCloudWatchSDKClient(ctx context.Context, input domain.ConnectionInput) (awsCloudWatchClient, error) {
	httpClient := &http.Client{Timeout: awsRequestTimeout}
	cfg, err := config.LoadDefaultConfig(
		ctx,
		config.WithRegion(strings.TrimSpace(input.Region)),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(input.AccessKey, input.SecretKey, "")),
		config.WithHTTPClient(httpClient),
	)
	if err != nil {
		return nil, fmt.Errorf("configure AWS SDK: %w", err)
	}
	endpoint := strings.TrimRight(strings.TrimSpace(input.Endpoint), "/")
	return cloudwatchlogs.NewFromConfig(cfg, func(options *cloudwatchlogs.Options) {
		options.BaseEndpoint = aws.String(endpoint)
	}), nil
}

func describeAllAWSLogGroups(ctx context.Context, client awsCloudWatchClient) ([]string, error) {
	names := make([]string, 0)
	var token *string
	for {
		output, err := client.DescribeLogGroups(ctx, &cloudwatchlogs.DescribeLogGroupsInput{
			Limit: aws.Int32(50), NextToken: token,
		})
		if err != nil {
			return nil, err
		}
		if output == nil {
			return nil, errors.New("empty DescribeLogGroups response")
		}
		for _, group := range output.LogGroups {
			if name := strings.TrimSpace(aws.ToString(group.LogGroupName)); name != "" {
				names = append(names, name)
			}
		}
		if output.NextToken == nil || sameStringPointer(token, output.NextToken) {
			break
		}
		token = output.NextToken
	}
	sort.Strings(names)
	return names, nil
}

func validateAWSInput(input domain.ConnectionInput) error {
	if strings.TrimSpace(input.AccessKey) == "" || strings.TrimSpace(input.SecretKey) == "" || strings.TrimSpace(input.Region) == "" {
		return errors.New("AWS CloudWatch requires Access Key ID, Secret Access Key and region")
	}
	endpoint, err := url.ParseRequestURI(strings.TrimSpace(input.Endpoint))
	if err != nil || endpoint.Scheme != "https" || endpoint.Host == "" {
		return errors.New("AWS CloudWatch endpoint must be a valid HTTPS URL")
	}
	if endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" || (endpoint.Path != "" && endpoint.Path != "/") {
		return errors.New("AWS CloudWatch endpoint must not contain credentials, a path, query, or fragment")
	}
	return nil
}

func parseAWSRange(fromValue, toValue string) (time.Time, time.Time, error) {
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

func normalizeAWSEvent(event awstypes.FilteredLogEvent) domain.LogEntry {
	message := aws.ToString(event.Message)
	fields := map[string]string{
		"@logStream": aws.ToString(event.LogStreamName),
		"@eventId":   aws.ToString(event.EventId),
	}
	if event.IngestionTime != nil {
		fields["@ingestionTime"] = time.UnixMilli(*event.IngestionTime).UTC().Format(time.RFC3339Nano)
	}
	level := ""
	var object map[string]any
	if json.Unmarshal([]byte(message), &object) == nil {
		for key, value := range object {
			encoded, _ := json.Marshal(value)
			fields[key] = strings.Trim(string(encoded), `"`)
		}
		level = resolveLogLevel("", object)
		if value, ok := object["message"].(string); ok {
			message = value
		}
	}
	level = resolveLogLevel(level, message)
	timestamp := ""
	if event.Timestamp != nil {
		timestamp = time.UnixMilli(*event.Timestamp).UTC().Format(time.RFC3339Nano)
	}
	return domain.LogEntry{Time: timestamp, Level: level, Message: message, Fields: fields}
}

func sameStringPointer(left, right *string) bool {
	return left != nil && right != nil && *left == *right
}
