package adapter

import "testing"

func TestRewriteSemanticLevelFilters(t *testing.T) {
	tests := []struct {
		name       string
		expression string
		want       string
	}{
		{name: "quoted warning", expression: `level:"WARN"`, want: `"WARN"`},
		{name: "canonical alias", expression: `service:"api" AND level:warning`, want: `service:"api" AND "WARN"`},
		{name: "negated error", expression: `NOT level:"ERROR"`, want: `NOT "ERROR"`},
		{name: "quoted field", expression: `("level":"critical")`, want: `("FATAL")`},
		{name: "nested provider field remains native", expression: `content.level:"WARN"`, want: `content.level:"WARN"`},
		{name: "unknown value remains native", expression: `level:"CUSTOM"`, want: `level:"CUSTOM"`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := rewriteSemanticLevelFilters(test.expression); got != test.want {
				t.Fatalf("rewriteSemanticLevelFilters(%q) = %q, want %q", test.expression, got, test.want)
			}
		})
	}
}
