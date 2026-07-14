package adapter

import (
	"regexp"
	"strconv"
	"strings"
)

var semanticLevelFilterPattern = regexp.MustCompile(
	`(?i)(^|[\s(])(?:"level"|level)\s*:\s*("(?:\\.|[^"])*"|[^\s|)]+)`,
)

// rewriteSemanticLevelFilters maps LogGopher's normalized level field to a full-text provider term.
// The normalized field may originate inside an embedded JSON string and therefore cannot reliably
// be queried as a provider-side top-level field.
func rewriteSemanticLevelFilters(expression string) string {
	return semanticLevelFilterPattern.ReplaceAllStringFunc(expression, func(clause string) string {
		parts := semanticLevelFilterPattern.FindStringSubmatch(clause)
		if len(parts) != 3 {
			return clause
		}
		raw := strings.TrimSpace(parts[2])
		if strings.HasPrefix(raw, `"`) {
			if decoded, err := strconv.Unquote(raw); err == nil {
				raw = decoded
			}
		}
		level := canonicalLogLevel(raw)
		if level == "" {
			return clause
		}
		return parts[1] + strconv.Quote(level)
	})
}
