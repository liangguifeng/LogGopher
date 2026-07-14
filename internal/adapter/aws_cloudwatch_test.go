package adapter

// This file exercises CloudWatch request mapping, pagination, errors, and normalization.

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatchlogs"
	awstypes "github.com/aws/aws-sdk-go-v2/service/cloudwatchlogs/types"
	"github.com/liangguifeng/LogGopher/internal/domain"
)

type fakeAWSClient struct {
	describeOutputs []*cloudwatchlogs.DescribeLogGroupsOutput
	describeErr     error
	describeInputs  []*cloudwatchlogs.DescribeLogGroupsInput
	filterOutputs   []*cloudwatchlogs.FilterLogEventsOutput
	filterErr       error
	filterInputs    []*cloudwatchlogs.FilterLogEventsInput
}

func (client *fakeAWSClient) DescribeLogGroups(
	_ context.Context,
	input *cloudwatchlogs.DescribeLogGroupsInput,
	_ ...func(*cloudwatchlogs.Options),
) (*cloudwatchlogs.DescribeLogGroupsOutput, error) {
	client.describeInputs = append(client.describeInputs, input)
	if client.describeErr != nil {
		return nil, client.describeErr
	}
	index := len(client.describeInputs) - 1
	return client.describeOutputs[index], nil
}

func (client *fakeAWSClient) FilterLogEvents(
	_ context.Context,
	input *cloudwatchlogs.FilterLogEventsInput,
	_ ...func(*cloudwatchlogs.Options),
) (*cloudwatchlogs.FilterLogEventsOutput, error) {
	client.filterInputs = append(client.filterInputs, input)
	if client.filterErr != nil {
		return nil, client.filterErr
	}
	index := len(client.filterInputs) - 1
	return client.filterOutputs[index], nil
}

func awsTestInput() domain.ConnectionInput {
	return domain.ConnectionInput{
		AdapterID: "aws-cloudwatch", Name: "aws-production",
		Endpoint: "https://logs.us-east-1.amazonaws.com", Region: "us-east-1",
		AccessKey: "test-access-key", SecretKey: "test-secret-key",
	}
}

func TestAWSConnectPaginatesAndSortsLogGroups(t *testing.T) {
	client := &fakeAWSClient{describeOutputs: []*cloudwatchlogs.DescribeLogGroupsOutput{
		{
			LogGroups: []awstypes.LogGroup{{LogGroupName: aws.String("/aws/lambda/z")}},
			NextToken: aws.String("next"),
		},
		{LogGroups: []awstypes.LogGroup{{LogGroupName: aws.String("/aws/lambda/a")}}},
	}}
	adapter := &awsCloudWatchAdapter{newClient: func(context.Context, domain.ConnectionInput) (awsCloudWatchClient, error) {
		return client, nil
	}}
	groups, err := adapter.Connect(context.Background(), awsTestInput())
	if err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	if len(groups) != 1 || groups[0].Name != "us-east-1" || len(groups[0].Logstores) != 2 {
		t.Fatalf("Connect() = %#v", groups)
	}
	if groups[0].Logstores[0] != "/aws/lambda/a" || aws.ToString(client.describeInputs[1].NextToken) != "next" {
		t.Fatalf("groups = %#v, inputs = %#v", groups, client.describeInputs)
	}
}

func TestAWSQueryMapsPageAndNormalizesJSONEvent(t *testing.T) {
	client := &fakeAWSClient{filterOutputs: []*cloudwatchlogs.FilterLogEventsOutput{
		{
			Events:    []awstypes.FilteredLogEvent{{Message: aws.String("first")}},
			NextToken: aws.String("page-2"),
		},
		{
			Events: []awstypes.FilteredLogEvent{{
				Timestamp: aws.Int64(1783818123456), IngestionTime: aws.Int64(1783818124000),
				Message:       aws.String(`{"level":"warn","message":"slow request","status":429}`),
				LogStreamName: aws.String("instance-1"), EventId: aws.String("event-1"),
			}},
			NextToken: aws.String("page-3"),
		},
	}}
	adapter := &awsCloudWatchAdapter{newClient: func(context.Context, domain.ConnectionInput) (awsCloudWatchClient, error) {
		return client, nil
	}}
	result, err := adapter.Query(context.Background(), awsTestInput(), domain.QueryInput{
		Group: "us-east-1", Logstore: "/aws/lambda/orders", Query: `{ $.status = 429 }`,
		From: "2026-07-12T00:00:00Z", To: "2026-07-12T01:00:00Z", Page: 2, Limit: 100,
	})
	if err != nil {
		t.Fatalf("Query() error = %v", err)
	}
	if len(client.filterInputs) != 2 || aws.ToString(client.filterInputs[1].NextToken) != "page-2" {
		t.Fatalf("FilterLogEvents inputs = %#v", client.filterInputs)
	}
	request := client.filterInputs[0]
	if aws.ToString(request.LogGroupName) != "/aws/lambda/orders" || aws.ToString(request.FilterPattern) != `{ $.status = 429 }` {
		t.Fatalf("FilterLogEvents request = %#v", request)
	}
	if result.Total != 201 || len(result.Entries) != 1 || result.Entries[0].Level != "WARN" {
		t.Fatalf("Query() = %#v", result)
	}
	entry := result.Entries[0]
	if entry.Message != "slow request" || entry.Fields["status"] != "429" || entry.Fields["@logStream"] != "instance-1" {
		t.Fatalf("normalized entry = %#v", entry)
	}
}

func TestAWSQueryRewritesNormalizedLevelFilter(t *testing.T) {
	client := &fakeAWSClient{filterOutputs: []*cloudwatchlogs.FilterLogEventsOutput{{}}}
	adapter := &awsCloudWatchAdapter{
		newClient: func(context.Context, domain.ConnectionInput) (awsCloudWatchClient, error) {
			return client, nil
		},
	}
	_, err := adapter.Query(context.Background(), awsTestInput(), domain.QueryInput{
		Group: "us-east-1", Logstore: "/aws/lambda/orders", Query: `level:"WARN"`,
		From: "2026-07-12T00:00:00Z", To: "2026-07-12T01:00:00Z", Page: 1, Limit: 100,
	})
	if err != nil {
		t.Fatalf("Query() error = %v", err)
	}
	if got := aws.ToString(client.filterInputs[0].FilterPattern); got != `"WARN"` {
		t.Fatalf("FilterPattern = %q, want %q", got, `"WARN"`)
	}
}

func TestAWSAdapterErrorsAndCancellation(t *testing.T) {
	client := &fakeAWSClient{describeErr: io.EOF}
	adapter := &awsCloudWatchAdapter{newClient: func(context.Context, domain.ConnectionInput) (awsCloudWatchClient, error) {
		return client, nil
	}}
	_, err := adapter.Connect(context.Background(), awsTestInput())
	if !errors.Is(err, io.EOF) || !strings.Contains(err.Error(), "list AWS CloudWatch Log Groups") {
		t.Fatalf("Connect() error = %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = adapter.Connect(ctx, awsTestInput())
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled Connect() error = %v", err)
	}

	invalid := awsTestInput()
	invalid.Endpoint = "http://logs.us-east-1.amazonaws.com"
	if err := validateAWSInput(invalid); err == nil {
		t.Fatal("validateAWSInput() accepted insecure endpoint")
	}
	if _, _, err := parseAWSRange("bad", time.Now().Format(time.RFC3339)); err == nil {
		t.Fatal("parseAWSRange() accepted an invalid start time")
	}
}

func TestAWSAdapterIsReadyInDefaultRegistry(t *testing.T) {
	registered, ok := DefaultRegistry().Get("aws-cloudwatch")
	if !ok || !registered.Info().Ready {
		t.Fatalf("registered adapter = %#v, ok = %v", registered, ok)
	}
}
