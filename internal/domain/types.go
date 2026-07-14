package domain

import (
	"errors"
	"net/url"
	"strings"
)

// AdapterInfo describes a log platform adapter exposed to the frontend.
type AdapterInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Ready       bool   `json:"ready"`
}

// ConnectionInput contains the metadata and credentials required to open a platform session.
type ConnectionInput struct {
	AdapterID string `json:"adapterId"`
	Name      string `json:"name"` // User-defined connection alias.
	Endpoint  string `json:"endpoint"`
	AccessKey string `json:"accessKey"`
	SecretKey string `json:"secretKey"`
	Project   string `json:"project"`
	Region    string `json:"region"`
}

// Validate checks whether the connection contains the fields required by its adapter.
func (c ConnectionInput) Validate() error {
	if strings.TrimSpace(c.AdapterID) == "" || strings.TrimSpace(c.Name) == "" {
		return errors.New("adapter and connection alias are required")
	}
	u, err := url.ParseRequestURI(c.Endpoint)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return errors.New("endpoint must be a valid HTTP(S) URL")
	}
	if c.AccessKey == "" || c.SecretKey == "" {
		return errors.New("access key and secret key are required")
	}
	switch c.AdapterID {
	case "tencent-cls", "aws-cloudwatch":
		if strings.TrimSpace(c.Region) == "" {
			return errors.New("region is required")
		}
	}
	return nil
}

// Profile is the frontend-safe portion of a saved connection; persisted credentials are omitted.
type Profile struct {
	ID        int64  `json:"id"`
	AdapterID string `json:"adapterId"`
	Name      string `json:"name"` // User-defined connection alias.
	Endpoint  string `json:"endpoint"`
	Project   string `json:"project"`
	Region    string `json:"region"`
}

// ProfileCredentials contains credentials explicitly requested by the connection editor.
type ProfileCredentials struct {
	AccessKey string `json:"accessKey"`
	SecretKey string `json:"secretKey"`
}

// Bootstrap contains the initial data required to render the application.
type Bootstrap struct {
	Adapters []AdapterInfo `json:"adapters"`
	Profiles []Profile     `json:"profiles"`
	Settings Settings      `json:"settings"`
}

// Settings contains user interface preferences persisted on the local machine.
type Settings struct {
	Theme    string `json:"theme"`
	Language string `json:"language"`
	Density  string `json:"density"`
}

// DefaultSettings returns preferences suitable for a first application launch.
func DefaultSettings() Settings {
	return Settings{Theme: "system", Language: "zh-CN", Density: "comfortable"}
}

// Validate rejects unsupported preference values before persistence.
func (s Settings) Validate() error {
	if s.Theme != "system" && s.Theme != "light" && s.Theme != "dark" {
		return errors.New("theme must be system, light or dark")
	}
	if s.Language != "zh-CN" && s.Language != "en-US" {
		return errors.New("language must be zh-CN or en-US")
	}
	if s.Density != "comfortable" && s.Density != "compact" {
		return errors.New("density must be comfortable or compact")
	}
	return nil
}

// LogGroup groups logstores under their provider-level parent resource.
type LogGroup struct {
	Name      string   `json:"name"`
	Logstores []string `json:"logstores"`
}

// Session identifies an active connection and its available grouped logstores.
type Session struct {
	ProfileID int64      `json:"profileId"`
	Groups    []LogGroup `json:"groups"`
}

// QueryInput is the vendor-neutral request accepted by every adapter.
type QueryInput struct {
	ProfileID int64  `json:"profileId"`
	Group     string `json:"group"`
	Logstore  string `json:"logstore"`
	Query     string `json:"query"`
	From      string `json:"from"`
	To        string `json:"to"`
	Page      int    `json:"page"`
	Limit     int    `json:"limit"`
}

// LogEntry is the normalized representation of a vendor log record.
type LogEntry struct {
	Time         string            `json:"time"`
	Level        string            `json:"level"` // Canonical FATAL, ERROR, WARN, INFO, DEBUG, or TRACE value.
	Message      string            `json:"message"`
	MessageField string            `json:"messageField"` // Original provider field normalized into Message.
	Fields       map[string]string `json:"fields"`
}

// HistogramBucket represents the exact provider-side count for one time interval.
type HistogramBucket struct {
	From  string `json:"from"`
	To    string `json:"to"`
	Count int64  `json:"count"`
}

// QueryResult contains one page of normalized log records.
type QueryResult struct {
	TookMS         int64             `json:"tookMs"`
	Total          int               `json:"total"`
	Entries        []LogEntry        `json:"entries"`
	Histogram      []HistogramBucket `json:"histogram"`
	IndexedFields  []string          `json:"indexedFields"`
	FullTextIndex  bool              `json:"fullTextIndex"`
	EffectiveQuery string            `json:"effectiveQuery"`
}

// QueryHistoryItem represents a recently executed query persisted in SQLite.
type QueryHistoryItem struct {
	Query     string `json:"query"`
	UpdatedAt string `json:"updatedAt"`
}
