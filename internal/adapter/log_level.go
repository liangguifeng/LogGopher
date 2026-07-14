package adapter

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

const defaultLogLevel = "INFO"

var logLevelKeys = []string{
	"levelname",
	"loglevel",
	"severitytext",
	"severity",
	"level",
}

// resolveLogLevel normalizes a primary level, then recursively inspects structured log payloads.
func resolveLogLevel(primary any, payloads ...any) string {
	if level := canonicalLogLevel(primary); level != "" {
		return level
	}
	for _, payload := range payloads {
		if level := findStructuredLogLevel(payload, 0); level != "" {
			return level
		}
	}
	return defaultLogLevel
}

// findStructuredLogLevel searches JSON strings, objects, and arrays with bounded recursion.
func findStructuredLogLevel(value any, depth int) string {
	if depth >= 10 || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		trimmed := strings.TrimSpace(typed)
		if !strings.HasPrefix(trimmed, "{") && !strings.HasPrefix(trimmed, "[") {
			return ""
		}
		var decoded any
		if json.Unmarshal([]byte(trimmed), &decoded) != nil {
			return ""
		}
		return findStructuredLogLevel(decoded, depth+1)
	case map[string]string:
		object := make(map[string]any, len(typed))
		for key, item := range typed {
			object[key] = item
		}
		return findStructuredLogLevel(object, depth+1)
	case map[string]any:
		for _, expected := range logLevelKeys {
			for key, item := range typed {
				if normalizedLevelKey(key) == expected {
					if level := canonicalLogLevel(item); level != "" {
						return level
					}
				}
			}
		}
		for _, preferred := range []string{"message", "msg", "content", "body"} {
			for key, item := range typed {
				if strings.EqualFold(key, preferred) {
					if level := findStructuredLogLevel(item, depth+1); level != "" {
						return level
					}
				}
			}
		}
		for _, item := range typed {
			if level := findStructuredLogLevel(item, depth+1); level != "" {
				return level
			}
		}
	case []any:
		for _, item := range typed {
			if level := findStructuredLogLevel(item, depth+1); level != "" {
				return level
			}
		}
	}
	return ""
}

func normalizedLevelKey(key string) string {
	return strings.ToLower(strings.NewReplacer("-", "", "_", "", ".", "").Replace(strings.TrimSpace(key)))
}

// canonicalLogLevel maps common textual and numeric logging conventions to the UI level contract.
func canonicalLogLevel(value any) string {
	raw := strings.ToUpper(strings.TrimSpace(fmt.Sprint(value)))
	raw = strings.Trim(raw, "[](){}\"'")
	switch raw {
	case "FATAL", "CRITICAL", "ALERT", "EMERGENCY", "PANIC", "DPANIC":
		return "FATAL"
	case "ERROR", "ERR", "SEVERE":
		return "ERROR"
	case "WARN", "WARNING":
		return "WARN"
	case "INFO", "INFORMATION", "NOTICE":
		return "INFO"
	case "DEBUG":
		return "DEBUG"
	case "TRACE", "VERBOSE":
		return "TRACE"
	case "", "UNKNOWN", "UNDEFINED", "NULL", "NIL", "<NIL>":
		return ""
	}
	number, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return ""
	}
	return canonicalNumericLogLevel(number)
}

func canonicalNumericLogLevel(level float64) string {
	switch {
	case level >= 600:
		return "FATAL"
	case level >= 500:
		return "FATAL"
	case level >= 400:
		return "ERROR"
	case level >= 300:
		return "WARN"
	case level >= 200:
		return "INFO"
	case level >= 100:
		return "DEBUG"
	case level >= 50:
		return "FATAL"
	case level >= 40:
		return "ERROR"
	case level >= 30:
		return "WARN"
	case level >= 20:
		return "INFO"
	case level >= 10:
		return "DEBUG"
	default:
		return ""
	}
}
