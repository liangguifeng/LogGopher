package domain

import (
	"errors"
	"net/url"
	"strings"
)

type AdapterInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Ready       bool   `json:"ready"`
}

type ConnectionInput struct {
	AdapterID string `json:"adapterId"`
	Name      string `json:"name"`
	Endpoint  string `json:"endpoint"`
	AccessKey string `json:"accessKey"`
	SecretKey string `json:"secretKey"`
	Project   string `json:"project"`
	Region    string `json:"region"`
}

func (c ConnectionInput) Validate() error {
	if strings.TrimSpace(c.AdapterID) == "" || strings.TrimSpace(c.Name) == "" {
		return errors.New("adapter and connection name are required")
	}
	if c.AdapterID == "demo" {
		return nil
	}
	u, err := url.ParseRequestURI(c.Endpoint)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return errors.New("endpoint must be a valid HTTP(S) URL")
	}
	if c.AccessKey == "" || c.SecretKey == "" || c.Project == "" {
		return errors.New("AK, SK and project are required")
	}
	return nil
}

type Profile struct {
	ID        int64  `json:"id"`
	AdapterID string `json:"adapterId"`
	Name      string `json:"name"`
	Endpoint  string `json:"endpoint"`
	Project   string `json:"project"`
	Region    string `json:"region"`
}

type Bootstrap struct {
	Adapters []AdapterInfo `json:"adapters"`
	Profiles []Profile     `json:"profiles"`
	Settings Settings      `json:"settings"`
}

type Settings struct {
	Theme    string `json:"theme"`
	Language string `json:"language"`
	Density  string `json:"density"`
}

func DefaultSettings() Settings {
	return Settings{Theme: "system", Language: "zh-CN", Density: "comfortable"}
}

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

type Session struct {
	ProfileID int64    `json:"profileId"`
	Logstores []string `json:"logstores"`
}

type QueryInput struct {
	ProfileID int64  `json:"profileId"`
	Logstore  string `json:"logstore"`
	Query     string `json:"query"`
	From      string `json:"from"`
	To        string `json:"to"`
	Page      int    `json:"page"`
	Limit     int    `json:"limit"`
}

type LogEntry struct {
	Time    string            `json:"time"`
	Level   string            `json:"level"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields"`
}

type QueryResult struct {
	TookMS  int64      `json:"tookMs"`
	Total   int        `json:"total"`
	Entries []LogEntry `json:"entries"`
}
