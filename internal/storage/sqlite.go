package storage

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/liangguifeng/LogGopher/internal/domain"
	_ "modernc.org/sqlite"
)

// ErrCredentialsNotFound indicates that a saved profile has no SQLite credentials yet.
var ErrCredentialsNotFound = errors.New("credentials not found")

// Store persists application settings, connection profiles, and credentials in SQLite.
type Store struct{ db *sql.DB }

// Open creates or opens the per-user SQLite database and applies migrations.
func Open() (*Store, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return nil, fmt.Errorf("resolve config directory: %w", err)
	}
	dir = filepath.Join(dir, "LogGopher")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create config directory: %w", err)
	}
	return OpenPath(filepath.Join(dir, "loggopher.db"))
}

// OpenPath opens a SQLite store at an explicit path and applies all migrations.
func OpenPath(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	if path != ":memory:" {
		if err := os.Chmod(path, 0o600); err != nil {
			db.Close()
			return nil, fmt.Errorf("restrict sqlite permissions: %w", err)
		}
	}
	return s, nil
}

// migrate creates the current schema and removes obsolete synthetic demo data.
func (s *Store) migrate() error {
	_, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS profiles (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		adapter_id TEXT NOT NULL,
		name TEXT NOT NULL UNIQUE,
		endpoint TEXT NOT NULL DEFAULT '',
		project TEXT NOT NULL DEFAULT '',
		region TEXT NOT NULL DEFAULT '',
		access_key TEXT NOT NULL DEFAULT '',
		secret_key TEXT NOT NULL DEFAULT '',
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
	if err == nil {
		err = s.ensureProfileCredentialColumns()
	}
	if err == nil {
		_, err = s.db.Exec(`CREATE TABLE IF NOT EXISTS query_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			profile_id INTEGER NOT NULL,
			logstore TEXT NOT NULL,
			query TEXT NOT NULL,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(profile_id, logstore, query)
		)`)
	}
	if err == nil {
		_, err = s.db.Exec(`DELETE FROM query_history WHERE profile_id IN (
			SELECT id FROM profiles WHERE adapter_id='demo'
		);
		DELETE FROM profiles WHERE adapter_id='demo'`)
	}
	if err != nil {
		return fmt.Errorf("migrate sqlite: %w", err)
	}
	return nil
}

// ensureProfileCredentialColumns upgrades databases created before credentials were stored in SQLite.
func (s *Store) ensureProfileCredentialColumns() error {
	for _, column := range []struct {
		name       string
		definition string
	}{
		{name: "access_key", definition: "TEXT NOT NULL DEFAULT ''"},
		{name: "secret_key", definition: "TEXT NOT NULL DEFAULT ''"},
	} {
		exists, err := s.profileColumnExists(column.name)
		if err != nil {
			return err
		}
		if !exists {
			if _, err := s.db.Exec("ALTER TABLE profiles ADD COLUMN " + column.name + " " + column.definition); err != nil {
				return fmt.Errorf("add profiles.%s: %w", column.name, err)
			}
		}
	}
	return nil
}

// profileColumnExists inspects SQLite metadata before applying an additive migration.
func (s *Store) profileColumnExists(name string) (bool, error) {
	rows, err := s.db.Query("PRAGMA table_info(profiles)")
	if err != nil {
		return false, fmt.Errorf("inspect profile columns: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var columnName, columnType string
		var notNull, primaryKey int
		var defaultValue sql.NullString
		if err := rows.Scan(&cid, &columnName, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return false, fmt.Errorf("scan profile column: %w", err)
		}
		if columnName == name {
			return true, nil
		}
	}
	return false, rows.Err()
}

// Settings loads the single persisted settings record.
func (s *Store) Settings() (domain.Settings, error) {
	settings := domain.DefaultSettings()
	err := s.db.QueryRow("SELECT theme,language,density FROM app_settings WHERE id = 1").Scan(&settings.Theme, &settings.Language, &settings.Density)
	if err != nil {
		return domain.Settings{}, fmt.Errorf("load settings: %w", err)
	}
	return settings, nil
}

// SaveSettings updates the single persisted settings record.
func (s *Store) SaveSettings(settings domain.Settings) error {
	_, err := s.db.Exec(`UPDATE app_settings SET theme=?,language=?,density=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`, settings.Theme, settings.Language, settings.Density)
	if err != nil {
		return fmt.Errorf("save settings: %w", err)
	}
	return nil
}

// SaveProfile atomically upserts connection metadata and credentials and returns its stable ID.
func (s *Store) SaveProfile(in domain.ConnectionInput) (int64, error) {
	var id int64
	err := s.db.QueryRow(`INSERT INTO profiles(adapter_id,name,endpoint,project,region,access_key,secret_key) VALUES(?,?,?,?,?,?,?)
		ON CONFLICT(name) DO UPDATE SET adapter_id=excluded.adapter_id,endpoint=excluded.endpoint,project=excluded.project,region=excluded.region,
		access_key=excluded.access_key,secret_key=excluded.secret_key,updated_at=CURRENT_TIMESTAMP
		RETURNING id`, in.AdapterID, in.Name, in.Endpoint, in.Project, in.Region, in.AccessKey, in.SecretKey).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("save profile: %w", err)
	}
	return id, nil
}

// Profiles lists saved connections ordered by most recent update.
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

// Profile loads one saved connection by ID.
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

// UpdateProfile atomically replaces connection metadata and credentials for a stable profile ID.
func (s *Store) UpdateProfile(id int64, in domain.ConnectionInput) error {
	result, err := s.db.Exec(`UPDATE profiles
		SET adapter_id=?,name=?,endpoint=?,project=?,region=?,access_key=?,secret_key=?,updated_at=CURRENT_TIMESTAMP
		WHERE id=?`, in.AdapterID, in.Name, in.Endpoint, in.Project, in.Region, in.AccessKey, in.SecretKey, id)
	if err != nil {
		return fmt.Errorf("update profile: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read updated profile count: %w", err)
	}
	if updated == 0 {
		return fmt.Errorf("profile not found")
	}
	return nil
}

// SaveCredentials stores plaintext credentials for a profile without exposing them through Profile.
func (s *Store) SaveCredentials(profileID int64, accessKey, secretKey string) error {
	result, err := s.db.Exec("UPDATE profiles SET access_key=?,secret_key=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", accessKey, secretKey, profileID)
	if err != nil {
		return fmt.Errorf("save profile credentials: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read saved credential count: %w", err)
	}
	if updated == 0 {
		return fmt.Errorf("profile not found")
	}
	return nil
}

// Credentials loads credentials exclusively for backend adapter use.
func (s *Store) Credentials(profileID int64) (string, string, error) {
	var accessKey, secretKey string
	err := s.db.QueryRow("SELECT access_key,secret_key FROM profiles WHERE id=?", profileID).Scan(&accessKey, &secretKey)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && accessKey == "" && secretKey == "") {
		return "", "", ErrCredentialsNotFound
	}
	if err != nil {
		return "", "", fmt.Errorf("load profile credentials: %w", err)
	}
	return accessKey, secretKey, nil
}

// DeleteCredentials clears credentials while leaving profile metadata intact.
func (s *Store) DeleteCredentials(profileID int64) error {
	result, err := s.db.Exec("UPDATE profiles SET access_key='',secret_key='',updated_at=CURRENT_TIMESTAMP WHERE id=?", profileID)
	if err != nil {
		return fmt.Errorf("delete profile credentials: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read deleted credential count: %w", err)
	}
	if updated == 0 {
		return fmt.Errorf("profile not found")
	}
	return nil
}

// DeleteProfile atomically removes profile metadata and its query history.
func (s *Store) DeleteProfile(id int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin profile deletion: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec("DELETE FROM query_history WHERE profile_id=?", id); err != nil {
		return fmt.Errorf("delete profile query history: %w", err)
	}
	result, err := tx.Exec("DELETE FROM profiles WHERE id=?", id)
	if err != nil {
		return fmt.Errorf("delete profile: %w", err)
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read deleted profile count: %w", err)
	}
	if deleted == 0 {
		return fmt.Errorf("profile not found")
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit profile deletion: %w", err)
	}
	return nil
}

// SaveQueryHistory upserts a query and trims history to the newest 50 entries.
func (s *Store) SaveQueryHistory(profileID int64, logstore, query string) error {
	query = strings.TrimSpace(query)
	if profileID <= 0 || logstore == "" || query == "" {
		return nil
	}
	if _, err := s.db.Exec(`INSERT INTO query_history(profile_id,logstore,query) VALUES(?,?,?)
		ON CONFLICT(profile_id,logstore,query) DO UPDATE SET updated_at=CURRENT_TIMESTAMP`, profileID, logstore, query); err != nil {
		return fmt.Errorf("save query history: %w", err)
	}
	_, err := s.db.Exec(`DELETE FROM query_history WHERE id IN (
		SELECT id FROM query_history WHERE profile_id=? AND logstore=? ORDER BY updated_at DESC, id DESC LIMIT -1 OFFSET 50
	)`, profileID, logstore)
	if err != nil {
		return fmt.Errorf("trim query history: %w", err)
	}
	return nil
}

// QueryHistory lists recent queries scoped to a profile and logstore.
func (s *Store) QueryHistory(profileID int64, logstore string, limit int) ([]domain.QueryHistoryItem, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	rows, err := s.db.Query(`SELECT query,updated_at FROM query_history WHERE profile_id=? AND logstore=? ORDER BY updated_at DESC,id DESC LIMIT ?`, profileID, logstore, limit)
	if err != nil {
		return nil, fmt.Errorf("load query history: %w", err)
	}
	defer rows.Close()
	items := make([]domain.QueryHistoryItem, 0)
	for rows.Next() {
		var item domain.QueryHistoryItem
		if err := rows.Scan(&item.Query, &item.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan query history: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// Close releases the SQLite connection pool.
func (s *Store) Close() error { return s.db.Close() }
