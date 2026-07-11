package storage

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	"github.com/liangguifeng/LogGopher/internal/domain"
	_ "modernc.org/sqlite"
)

type Store struct{ db *sql.DB }

func Open() (*Store, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return nil, fmt.Errorf("resolve config directory: %w", err)
	}
	dir = filepath.Join(dir, "LogGopher")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create config directory: %w", err)
	}
	db, err := sql.Open("sqlite", filepath.Join(dir, "loggopher.db"))
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS profiles (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		adapter_id TEXT NOT NULL,
		name TEXT NOT NULL UNIQUE,
		endpoint TEXT NOT NULL DEFAULT '',
		project TEXT NOT NULL DEFAULT '',
		region TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE IF NOT EXISTS app_settings (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system','light','dark')),
		language TEXT NOT NULL DEFAULT 'zh-CN' CHECK (language IN ('zh-CN','en-US')),
		density TEXT NOT NULL DEFAULT 'comfortable' CHECK (density IN ('comfortable','compact')),
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	INSERT OR IGNORE INTO app_settings(id) VALUES(1)`)
	if err != nil {
		return fmt.Errorf("migrate sqlite: %w", err)
	}
	return nil
}

func (s *Store) Settings() (domain.Settings, error) {
	settings := domain.DefaultSettings()
	err := s.db.QueryRow("SELECT theme,language,density FROM app_settings WHERE id = 1").Scan(&settings.Theme, &settings.Language, &settings.Density)
	if err != nil {
		return domain.Settings{}, fmt.Errorf("load settings: %w", err)
	}
	return settings, nil
}

func (s *Store) SaveSettings(settings domain.Settings) error {
	_, err := s.db.Exec(`UPDATE app_settings SET theme=?,language=?,density=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`, settings.Theme, settings.Language, settings.Density)
	if err != nil {
		return fmt.Errorf("save settings: %w", err)
	}
	return nil
}

func (s *Store) SaveProfile(in domain.ConnectionInput) (int64, error) {
	var id int64
	err := s.db.QueryRow(`INSERT INTO profiles(adapter_id,name,endpoint,project,region) VALUES(?,?,?,?,?)
		ON CONFLICT(name) DO UPDATE SET adapter_id=excluded.adapter_id,endpoint=excluded.endpoint,project=excluded.project,region=excluded.region,updated_at=CURRENT_TIMESTAMP
		RETURNING id`, in.AdapterID, in.Name, in.Endpoint, in.Project, in.Region).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("save profile: %w", err)
	}
	return id, nil
}

func (s *Store) Profiles() ([]domain.Profile, error) {
	rows, err := s.db.Query("SELECT id,adapter_id,name,endpoint,project,region FROM profiles ORDER BY updated_at DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var profiles []domain.Profile
	for rows.Next() {
		var p domain.Profile
		if err := rows.Scan(&p.ID, &p.AdapterID, &p.Name, &p.Endpoint, &p.Project, &p.Region); err != nil {
			return nil, err
		}
		profiles = append(profiles, p)
	}
	return profiles, rows.Err()
}

func (s *Store) Profile(id int64) (domain.Profile, error) {
	var profile domain.Profile
	err := s.db.QueryRow("SELECT id,adapter_id,name,endpoint,project,region FROM profiles WHERE id = ?", id).
		Scan(&profile.ID, &profile.AdapterID, &profile.Name, &profile.Endpoint, &profile.Project, &profile.Region)
	if err == sql.ErrNoRows {
		return domain.Profile{}, fmt.Errorf("profile not found")
	}
	if err != nil {
		return domain.Profile{}, fmt.Errorf("load profile: %w", err)
	}
	return profile, nil
}

func (s *Store) Close() error { return s.db.Close() }
