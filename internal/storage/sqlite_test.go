package storage

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/liangguifeng/LogGopher/internal/domain"
	_ "modernc.org/sqlite"
)

func TestMigration(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO profiles(adapter_id,name) VALUES(?,?)", "aliyun-sls", "local"); err != nil {
		t.Fatal(err)
	}
	input := domain.ConnectionInput{AdapterID: "aliyun-sls", Name: "saved-sls"}
	firstID, err := s.SaveProfile(input)
	if err != nil {
		t.Fatal(err)
	}
	secondID, err := s.SaveProfile(input)
	if err != nil || firstID != secondID {
		t.Fatalf("upsert changed profile id: %d -> %d, err %v", firstID, secondID, err)
	}
	settings, err := s.Settings()
	if err != nil {
		t.Fatal(err)
	}
	if settings.Theme != "system" || settings.Language != "zh-CN" || settings.Density != "comfortable" {
		t.Fatalf("unexpected defaults: %+v", settings)
	}
	settings.Theme = "light"
	settings.Language = "en-US"
	settings.Density = "compact"
	if err := s.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	saved, err := s.Settings()
	if err != nil || saved != settings {
		t.Fatalf("settings were not persisted: got %+v, err %v", saved, err)
	}
}

func TestOpenPathProfilesAndMissingProfile(t *testing.T) {
	store, err := OpenPath(filepath.Join(t.TempDir(), "profiles.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	first := domain.ConnectionInput{
		AdapterID: "aliyun-sls", Name: "production", Endpoint: "https://example.com",
		Project: "project-a", Region: "cn-hangzhou",
	}
	firstID, err := store.SaveProfile(first)
	if err != nil {
		t.Fatal(err)
	}
	secondID, err := store.SaveProfile(domain.ConnectionInput{AdapterID: "tencent-cls", Name: "staging"})
	if err != nil {
		t.Fatal(err)
	}
	profiles, err := store.Profiles()
	if err != nil || len(profiles) != 2 {
		t.Fatalf("Profiles() = %#v, %v", profiles, err)
	}
	profile, err := store.Profile(firstID)
	if err != nil || profile.Project != "project-a" || profile.ID != firstID {
		t.Fatalf("Profile() = %#v, %v", profile, err)
	}
	if _, err := store.Profile(secondID + 100); err == nil {
		t.Fatal("Profile() found a missing profile")
	}
}

func TestQueryHistoryTrimsAndIgnoresInvalidEntries(t *testing.T) {
	store, err := OpenPath(filepath.Join(t.TempDir(), "history.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	for index := 0; index < 55; index++ {
		if err := store.SaveQueryHistory(1, "app", fmt.Sprintf("query-%02d", index)); err != nil {
			t.Fatal(err)
		}
	}
	for _, invalid := range []struct {
		profileID int64
		logstore  string
		query     string
	}{{0, "app", "ignored"}, {1, "", "ignored"}, {1, "app", "  "}} {
		if err := store.SaveQueryHistory(invalid.profileID, invalid.logstore, invalid.query); err != nil {
			t.Fatal(err)
		}
	}
	items, err := store.QueryHistory(1, "app", 100)
	if err != nil || len(items) != 20 {
		t.Fatalf("QueryHistory(default limit) = %d, %v", len(items), err)
	}
	items, err = store.QueryHistory(1, "app", 50)
	if err != nil || len(items) != 50 {
		t.Fatalf("QueryHistory(50) = %d, %v", len(items), err)
	}
}

func TestMigrationDeletesDemoProfilesAndHistory(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		t.Fatal(err)
	}
	result, err := db.Exec("INSERT INTO profiles(adapter_id,name) VALUES(?,?)", "demo", "legacy-demo")
	if err != nil {
		t.Fatal(err)
	}
	profileID, _ := result.LastInsertId()
	if _, err := db.Exec(
		"INSERT INTO query_history(profile_id,logstore,query) VALUES(?,?,?)",
		profileID, "app-production", "*",
	); err != nil {
		t.Fatal(err)
	}
	if err := s.migrate(); err != nil {
		t.Fatal(err)
	}
	var profileCount, historyCount int
	_ = db.QueryRow("SELECT COUNT(*) FROM profiles WHERE adapter_id='demo'").Scan(&profileCount)
	_ = db.QueryRow("SELECT COUNT(*) FROM query_history WHERE profile_id=?", profileID).Scan(&historyCount)
	if profileCount != 0 || historyCount != 0 {
		t.Fatalf("demo data remains: profiles=%d history=%d", profileCount, historyCount)
	}
}

func TestQueryHistoryIsScopedAndDeduplicated(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{"level:ERROR", "service:gateway", "level:ERROR"} {
		if err := s.SaveQueryHistory(1, "app", query); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.SaveQueryHistory(2, "app", "other-profile"); err != nil {
		t.Fatal(err)
	}
	items, err := s.QueryHistory(1, "app", 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || (items[0].Query != "level:ERROR" && items[1].Query != "level:ERROR") {
		t.Fatalf("unexpected history: %+v", items)
	}
}
