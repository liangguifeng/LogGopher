package adapter

// This file locks the SLS fallback rewrite and pipeline parsing semantics.

import (
	"errors"
	"testing"

	sls "github.com/aliyun/aliyun-log-go-sdk"
)

func TestRewriteAliyunUnindexedFilterAsFullText(t *testing.T) {
	tests := []struct {
		name       string
		expression string
		field      string
		want       string
	}{
		{
			name:       "exclude nested json field",
			expression: "* not content.type: business",
			field:      "content.type",
			want:       "* not business",
		},
		{
			name:       "include before existing pipeline",
			expression: "service: api and content.type: \"member change\" | project content",
			field:      "content.type",
			want:       `service: api and "member change" | project content`,
		},
		{
			name:       "top level field",
			expression: "request: POST",
			field:      "request",
			want:       "* and POST",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, ok := rewriteAliyunUnindexedFilterAsFullText(test.expression, test.field)
			if !ok || got != test.want {
				t.Fatalf("rewriteAliyunUnindexedFilterAsFullText() = %q, %v; want %q", got, ok, test.want)
			}
		})
	}
}

func TestRewriteAliyunUnindexedFilterAsFullTextRejectsAmbiguousOR(t *testing.T) {
	expression := "service: api or content.type: business"
	if got, ok := rewriteAliyunUnindexedFilterAsFullText(expression, "content.type"); ok || got != expression {
		t.Fatalf("ambiguous rewrite = %q, %v", got, ok)
	}
}

func TestAliyunUnindexedKey(t *testing.T) {
	err := &sls.Error{Code: "ParameterInvalid", Message: "key (content.type) is not config as key value config"}
	if key, ok := aliyunUnindexedKey(err); !ok || key != "content.type" {
		t.Fatalf("aliyunUnindexedKey() = %q, %v", key, ok)
	}
	if _, ok := aliyunUnindexedKey(errors.New("network")); ok {
		t.Fatal("non-SLS error must not be classified as an unindexed field")
	}
}

func TestAliyunUsesSPL(t *testing.T) {
	if !aliyunUsesSPL("* | where status = '500'") {
		t.Fatal("where pipeline must use SPL scan mode")
	}
	if aliyunUsesSPL("* | SELECT count(*)") || aliyunUsesSPL("status: 500") {
		t.Fatal("SQL and index queries must not be classified as SPL")
	}
}
