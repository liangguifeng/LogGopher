package adapter

// This file verifies cross-provider structured log-level normalization.

import (
	"testing"

	awstypes "github.com/aws/aws-sdk-go-v2/service/cloudwatchlogs/types"
	cls "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/cls/v20201016"
)

func TestResolveLogLevel(t *testing.T) {
	tests := []struct {
		name     string
		primary  any
		payloads []any
		want     string
	}{
		{name: "valid primary wins", primary: "warning", payloads: []any{`{"level_name":"INFO"}`}, want: "WARN"},
		{
			name: "unknown primary uses embedded message", primary: "UNKNOWN",
			payloads: []any{`{"message":"done","level_name":"INFO","level":200}`}, want: "INFO",
		},
		{
			name:     "recursively decodes message",
			payloads: []any{map[string]any{"message": `{"context":{"severity":"ERROR"}}`}}, want: "ERROR",
		},
		{name: "monolog number", payloads: []any{map[string]any{"level": 300}}, want: "WARN"},
		{name: "unrecognized defaults to info", primary: "custom", payloads: []any{"plain text"}, want: "INFO"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := resolveLogLevel(test.primary, test.payloads...); got != test.want {
				t.Fatalf("resolveLogLevel() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestCloudAdapterNormalizationUsesSharedLogLevelRules(t *testing.T) {
	tencentJSON := `{"level":"UNKNOWN","message":"{\"level_name\":\"ERROR\",\"message\":\"failed\"}"}`
	tencentEntry := normalizeTencentLog(&cls.LogInfo{LogJson: &tencentJSON})
	if tencentEntry.Level != "ERROR" {
		t.Fatalf("Tencent embedded level = %q, want ERROR", tencentEntry.Level)
	}

	awsMessage := `{"level":"UNKNOWN","message":"{\"severity_text\":\"WARNING\",\"message\":\"slow\"}"}`
	awsEntry := normalizeAWSEvent(awstypes.FilteredLogEvent{Message: &awsMessage})
	if awsEntry.Level != "WARN" {
		t.Fatalf("AWS embedded level = %q, want WARN", awsEntry.Level)
	}

	plainMessage := "plain cloud log"
	awsFallback := normalizeAWSEvent(awstypes.FilteredLogEvent{Message: &plainMessage})
	if awsFallback.Level != "INFO" {
		t.Fatalf("AWS fallback level = %q, want INFO", awsFallback.Level)
	}
}

func TestNormalizeAliyunLogUsesEmbeddedLevelAndInfoFallback(t *testing.T) {
	entry := normalizeAliyunLog(map[string]string{
		"level":   "UNKNOWN",
		"message": `{"message":"执行消费逻辑结束","level_name":"INFO","level":200}`,
	})
	if entry.Level != "INFO" {
		t.Fatalf("embedded level = %q, want INFO", entry.Level)
	}
	fallback := normalizeAliyunLog(map[string]string{"message": "plain log"})
	if fallback.Level != "INFO" {
		t.Fatalf("fallback level = %q, want INFO", fallback.Level)
	}
}
