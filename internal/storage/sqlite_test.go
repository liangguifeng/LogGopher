package storage

import (
	"database/sql"
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
	if _, err := db.Exec("INSERT INTO profiles(adapter_id,name) VALUES(?,?)", "demo", "local"); err != nil {
		t.Fatal(err)
	}
	input := domain.ConnectionInput{AdapterID: "demo", Name: "saved-demo"}
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
