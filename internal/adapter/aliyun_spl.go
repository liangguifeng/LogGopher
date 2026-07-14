package adapter

import (
	"errors"
	"regexp"
	"strconv"
	"strings"

	sls "github.com/aliyun/aliyun-log-go-sdk"
)

const aliyunQueryRewriteLimit = 8

var (
	aliyunUnindexedKeyPattern = regexp.MustCompile(`(?i)key \(([^)]+)\) is not config as key value config`)
	aliyunSimpleFieldPattern  = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
)

// aliyunUnindexedKey extracts the field rejected by SLS as an unindexed Key:Value query.
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

// rewriteAliyunUnindexedFilterAsSPL moves one rejected field clause into a scan predicate.
func rewriteAliyunUnindexedFilterAsSPL(expression, field string) (string, bool) {
	search, pipeline := splitAliyunExpression(expression)
	if strings.Contains(strings.ToLower(search), " or ") {
		// Rewriting an OR branch requires a complete expression parser to preserve precedence.
		return expression, false
	}
	quotedField := regexp.QuoteMeta(field)
	clause := regexp.MustCompile(
		`(?i)(^|\s+)(?:and\s+)?(not\s+)?(?:"` + quotedField + `"|` + quotedField +
			`)\s*:\s*("(?:\\.|[^"])*"|[^\s|)]+)`,
	)
	match := clause.FindStringSubmatch(search)
	if len(match) != 4 {
		return expression, false
	}
	value := strings.TrimSpace(match[3])
	if strings.HasPrefix(value, `"`) {
		decoded, err := strconv.Unquote(value)
		if err != nil {
			return expression, false
		}
		value = decoded
	}
	remaining := strings.TrimSpace(clause.ReplaceAllString(search, ""))
	if remaining == "" {
		remaining = "*"
	}
	predicate := aliyunSPLPredicate(field, value, strings.TrimSpace(match[2]) != "")
	if strings.TrimSpace(pipeline) == "" {
		return remaining + " | where " + predicate, true
	}
	return remaining + " | where " + predicate + " | " + strings.TrimSpace(pipeline), true
}

// aliyunSPLPredicate compares an unindexed raw field or a nested JSON value as text.
func aliyunSPLPredicate(field, value string, exclude bool) string {
	root, path, nested := strings.Cut(field, ".")
	reference := aliyunSPLField(root)
	if nested {
		jsonPath := strings.ReplaceAll("$."+path, "'", "''")
		reference = "json_extract_scalar(" + reference + ", '" + jsonPath + "')"
	}
	literal := "'" + strings.ReplaceAll(value, "'", "''") + "'"
	if exclude {
		return reference + " is null or " + reference + " != " + literal
	}
	return reference + " = " + literal
}

// aliyunSPLField quotes raw field names that are not simple SPL identifiers.
func aliyunSPLField(field string) string {
	if aliyunSimpleFieldPattern.MatchString(field) {
		return field
	}
	return `"` + strings.ReplaceAll(field, `"`, `""`) + `"`
}

// splitAliyunExpression separates the index query from the first pipeline outside quotes.
func splitAliyunExpression(expression string) (string, string) {
	var quote rune
	escaped := false
	for index, character := range expression {
		if escaped {
			escaped = false
			continue
		}
		if character == '\\' {
			escaped = true
			continue
		}
		if quote != 0 {
			if character == quote {
				quote = 0
			}
			continue
		}
		if character == '\'' || character == '"' {
			quote = character
			continue
		}
		if character == '|' {
			return expression[:index], expression[index+1:]
		}
	}
	return expression, ""
}

// aliyunUsesSPL distinguishes scan pipelines from SQL analysis pipelines.
func aliyunUsesSPL(expression string) bool {
	_, pipeline := splitAliyunExpression(expression)
	pipeline = strings.ToLower(strings.TrimSpace(pipeline))
	return pipeline != "" && !strings.HasPrefix(pipeline, "select ") &&
		!strings.HasPrefix(pipeline, "set session ")
}
