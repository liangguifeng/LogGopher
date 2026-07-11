package adapter

import (
	"context"
	"testing"
	"time"

	"github.com/liangguifeng/LogGopher/internal/domain"
)

func TestDemoQueryFillsSelectedRange(t *testing.T) {
	to := time.Now().UTC().Truncate(time.Second)
	from := to.Add(-15 * time.Minute)
	result, err := (demoAdapter{}).Query(context.Background(), domain.ConnectionInput{}, domain.QueryInput{
		Logstore: "app-production", From: from.Format(time.RFC3339), To: to.Format(time.RFC3339), Limit: 100,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Total < 85 || result.Total > 91 || len(result.Entries) != result.Total {
		t.Fatalf("unexpected demo result size: total=%d entries=%d", result.Total, len(result.Entries))
	}
	first, err := time.Parse(time.RFC3339Nano, result.Entries[0].Time)
	if err != nil || first.Before(from) || first.After(to) {
		t.Fatalf("first entry is outside range: %s", result.Entries[0].Time)
	}
	if result.Entries[0].Fields["context"] == "" {
		t.Fatal("expected structured demo context")
	}
	drillFrom := to.Add(-time.Minute)
	drill, err := (demoAdapter{}).Query(context.Background(), domain.ConnectionInput{}, domain.QueryInput{
		Logstore: "app-production", From: drillFrom.Format(time.RFC3339), To: to.Format(time.RFC3339), Limit: 100,
	})
	if err != nil || drill.Total < 4 || drill.Total > 7 {
		t.Fatalf("drill-down should filter fixed demo data: total=%d err=%v", drill.Total, err)
	}
}

func TestDemoQueryPaginates(t *testing.T) {
	to := time.Now().UTC().Truncate(time.Second)
	from := to.Add(-30 * time.Minute)
	first, err := (demoAdapter{}).Query(context.Background(), domain.ConnectionInput{}, domain.QueryInput{
		Logstore: "app-production", From: from.Format(time.RFC3339), To: to.Format(time.RFC3339), Page: 1, Limit: 20,
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := (demoAdapter{}).Query(context.Background(), domain.ConnectionInput{}, domain.QueryInput{
		Logstore: "app-production", From: from.Format(time.RFC3339), To: to.Format(time.RFC3339), Page: 2, Limit: 20,
	})
	if err != nil {
		t.Fatal(err)
	}
	if first.Total != second.Total || len(first.Entries) != 20 || len(second.Entries) != 20 {
		t.Fatalf("unexpected pages: first=%d/%d second=%d/%d", len(first.Entries), first.Total, len(second.Entries), second.Total)
	}
	if first.Entries[0].Time == second.Entries[0].Time {
		t.Fatal("page 2 repeated page 1")
	}
}
