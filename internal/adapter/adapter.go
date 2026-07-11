package adapter

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/liangguifeng/LogGopher/internal/domain"
)

var ErrNotImplemented = errors.New("cloud SDK adapter is not implemented yet")

type Adapter interface {
	Info() domain.AdapterInfo
	Connect(context.Context, domain.ConnectionInput) ([]string, error)
	Query(context.Context, domain.ConnectionInput, domain.QueryInput) (domain.QueryResult, error)
}

type Registry struct{ items map[string]Adapter }

func DefaultRegistry() *Registry {
	r := &Registry{items: make(map[string]Adapter)}
	r.Register(demoAdapter{})
	for _, info := range []domain.AdapterInfo{
		{ID: "aliyun-sls", Name: "阿里云 SLS", Description: "Simple Log Service", Ready: false},
		{ID: "tencent-cls", Name: "腾讯云 CLS", Description: "Cloud Log Service", Ready: false},
		{ID: "aws-cloudwatch", Name: "AWS CloudWatch", Description: "CloudWatch Logs", Ready: false},
	} {
		r.Register(stubAdapter{info: info})
	}
	return r
}

func (r *Registry) Register(a Adapter)            { r.items[a.Info().ID] = a }
func (r *Registry) Get(id string) (Adapter, bool) { a, ok := r.items[id]; return a, ok }
func (r *Registry) List() []domain.AdapterInfo {
	order := []string{"demo", "aliyun-sls", "tencent-cls", "aws-cloudwatch"}
	result := make([]domain.AdapterInfo, 0, len(order))
	for _, id := range order {
		result = append(result, r.items[id].Info())
	}
	return result
}

type stubAdapter struct{ info domain.AdapterInfo }

func (a stubAdapter) Info() domain.AdapterInfo { return a.info }
func (a stubAdapter) Connect(context.Context, domain.ConnectionInput) ([]string, error) {
	return nil, fmt.Errorf("%s: %w", a.info.Name, ErrNotImplemented)
}
func (a stubAdapter) Query(context.Context, domain.ConnectionInput, domain.QueryInput) (domain.QueryResult, error) {
	return domain.QueryResult{}, ErrNotImplemented
}

type demoAdapter struct{}

func (demoAdapter) Info() domain.AdapterInfo {
	return domain.AdapterInfo{ID: "demo", Name: "本地演示", Description: "无需凭证，验证完整查询流程", Ready: true}
}
func (demoAdapter) Connect(context.Context, domain.ConnectionInput) ([]string, error) {
	return []string{"app-production", "gateway-access", "audit-events"}, nil
}
func (demoAdapter) Query(_ context.Context, _ domain.ConnectionInput, q domain.QueryInput) (domain.QueryResult, error) {
	from, to := demoRange(q.From, q.To)
	const total = 180
	windowEnd := time.Now().UTC().Truncate(time.Second)
	windowStart := windowEnd.Add(-30 * time.Minute)
	services := []string{"gateway", "checkout", "order", "user", "inventory"}
	levels := []string{"INFO", "INFO", "INFO", "WARN", "ERROR"}
	messages := []string{"request completed", "cache refreshed", "payment callback accepted", "upstream latency exceeded threshold", "database connection timeout"}
	entries := make([]domain.LogEntry, 0, total)
	for i := 0; i < total; i++ {
		timestamp := windowStart.Add(time.Duration(i+1) * 10 * time.Second)
		if timestamp.Before(from) || timestamp.After(to) {
			continue
		}
		service := services[i%len(services)]
		level := levels[(i*7)%len(levels)]
		message := messages[(i*3)%len(messages)]
		entry := domain.LogEntry{
			Time:  timestamp.Format(time.RFC3339Nano),
			Level: level, Message: message,
			Fields: map[string]string{
				"service": service, "status": demoStatus(level), "trace_id": fmt.Sprintf("trace-%06d", 104201+i),
				"host": fmt.Sprintf("%s-%02d", service, i%8+1), "region": "cn-hangzhou",
				"latency_ms": strconv.Itoa(18 + (i*37)%980), "method": []string{"GET", "POST", "PUT"}[i%3],
				"path": []string{"/api/orders", "/api/users", "/health", "/api/payments"}[i%4], "logstore": q.Logstore,
				"context": fmt.Sprintf(`{"request_id":"req-%06d","retry":%d,"sampled":%t}`, 880000+i, i%3, i%2 == 0),
			},
		}
		if demoMatches(entry, q.Query) {
			entries = append(entries, entry)
		}
	}
	totalMatched := len(entries)
	limit := q.Limit
	if limit <= 0 {
		limit = 100
	}
	page := q.Page
	if page < 1 {
		page = 1
	}
	start := (page - 1) * limit
	if start >= totalMatched {
		return domain.QueryResult{TookMS: 24, Total: totalMatched, Entries: []domain.LogEntry{}}, nil
	}
	end := start + limit
	if end > totalMatched {
		end = totalMatched
	}
	return domain.QueryResult{TookMS: 24, Total: totalMatched, Entries: entries[start:end]}, nil
}

func demoRange(fromValue, toValue string) (time.Time, time.Time) {
	to, err := time.Parse(time.RFC3339, toValue)
	if err != nil {
		to = time.Now()
	}
	from, err := time.Parse(time.RFC3339, fromValue)
	if err != nil || !from.Before(to) {
		from = to.Add(-15 * time.Minute)
	}
	return from, to
}

func demoStatus(level string) string {
	if level == "ERROR" {
		return "500"
	}
	if level == "WARN" {
		return "429"
	}
	return "200"
}

func demoMatches(entry domain.LogEntry, query string) bool {
	query = strings.TrimSpace(strings.ToLower(query))
	if query == "" || query == "*" {
		return true
	}
	searchable := strings.ToLower(entry.Level + " " + entry.Message + " " + entry.Fields["service"] + " " + entry.Fields["status"])
	return strings.Contains(searchable, query)
}
