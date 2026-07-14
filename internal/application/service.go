package application

import (
	"context"
	"errors"
	"strings"
	"sync"

	"github.com/liangguifeng/LogGopher/internal/adapter"
	"github.com/liangguifeng/LogGopher/internal/credential"
	"github.com/liangguifeng/LogGopher/internal/domain"
	"github.com/liangguifeng/LogGopher/internal/storage"
)

// Service coordinates persistence, credentials, adapters, and active sessions.
type Service struct {
	store       *storage.Store
	registry    *adapter.Registry
	credentials credential.Store
	ctx         context.Context
	mu          sync.RWMutex
	sessions    map[int64]domain.ConnectionInput
}

// NewService creates the application layer with its required infrastructure dependencies.
func NewService(store *storage.Store, registry *adapter.Registry, credentials credential.Store) *Service {
	return &Service{store: store, registry: registry, credentials: credentials, ctx: context.Background(), sessions: make(map[int64]domain.ConnectionInput)}
}

// Start installs the lifecycle context used for adapter operations.
func (s *Service) Start(ctx context.Context) { s.ctx = ctx }

// Close releases persistent application resources.
func (s *Service) Close() error { return s.store.Close() }

// Bootstrap loads adapters, saved profiles, and user settings for the frontend.
func (s *Service) Bootstrap() (domain.Bootstrap, error) {
	p, err := s.store.Profiles()
	if err != nil {
		return domain.Bootstrap{}, err
	}
	settings, err := s.store.Settings()
	return domain.Bootstrap{Adapters: s.registry.List(), Profiles: p, Settings: settings}, err
}

// SaveSettings persists validated user preferences.
func (s *Service) SaveSettings(settings domain.Settings) error { return s.store.SaveSettings(settings) }

// Connect validates an adapter session and persists its profile and credentials.
func (s *Service) Connect(in domain.ConnectionInput) (domain.Session, error) {
	a, ok := s.registry.Get(in.AdapterID)
	if !ok {
		return domain.Session{}, errors.New("unknown adapter")
	}
	groups, err := a.Connect(s.ctx, in)
	if err != nil {
		return domain.Session{}, err
	}
	id, err := s.store.SaveProfile(in)
	if err != nil {
		return domain.Session{}, err
	}
	if err := s.credentials.Save(id, credential.Secret{AccessKey: in.AccessKey, SecretKey: in.SecretKey}); err != nil {
		return domain.Session{}, err
	}
	s.mu.Lock()
	s.sessions[id] = in
	s.mu.Unlock()
	return domain.Session{ProfileID: id, Groups: groups}, nil
}

// ConnectSaved restores metadata and credentials before opening a new active session.
func (s *Service) ConnectSaved(profileID int64) (domain.Session, error) {
	profile, err := s.store.Profile(profileID)
	if err != nil {
		return domain.Session{}, err
	}
	in := domain.ConnectionInput{
		AdapterID: profile.AdapterID, Name: profile.Name, Endpoint: profile.Endpoint,
		Project: profile.Project, Region: profile.Region,
	}
	secret, err := s.credentials.Get(profileID)
	if err != nil {
		return domain.Session{}, err
	}
	in.AccessKey, in.SecretKey = secret.AccessKey, secret.SecretKey
	a, ok := s.registry.Get(in.AdapterID)
	if !ok {
		return domain.Session{}, errors.New("unknown adapter")
	}
	groups, err := a.Connect(s.ctx, in)
	if err != nil {
		return domain.Session{}, err
	}
	s.mu.Lock()
	s.sessions[profileID] = in
	s.mu.Unlock()
	return domain.Session{ProfileID: profileID, Groups: groups}, nil
}

// ProfileCredentials loads saved credentials for the explicit profile editing flow.
func (s *Service) ProfileCredentials(profileID int64) (domain.ProfileCredentials, error) {
	if profileID <= 0 {
		return domain.ProfileCredentials{}, errors.New("profile is required")
	}
	if _, err := s.store.Profile(profileID); err != nil {
		return domain.ProfileCredentials{}, err
	}
	secret, err := s.credentials.Get(profileID)
	if err != nil {
		return domain.ProfileCredentials{}, err
	}
	return domain.ProfileCredentials{AccessKey: secret.AccessKey, SecretKey: secret.SecretKey}, nil
}

// UpdateProfile replaces saved metadata and optionally rotates stored credentials.
func (s *Service) UpdateProfile(profileID int64, in domain.ConnectionInput) error {
	if profileID <= 0 {
		return errors.New("profile is required")
	}
	current, err := s.store.Profile(profileID)
	if err != nil {
		return err
	}
	currentSecret, err := s.credentials.Get(profileID)
	if err != nil {
		return err
	}
	if in.AccessKey == "" {
		in.AccessKey = currentSecret.AccessKey
	}
	if in.SecretKey == "" {
		in.SecretKey = currentSecret.SecretKey
	}
	if err := in.Validate(); err != nil {
		return err
	}
	if _, ok := s.registry.Get(in.AdapterID); !ok {
		return errors.New("unknown adapter")
	}
	if err := s.store.UpdateProfile(profileID, in); err != nil {
		return err
	}
	if err := s.credentials.Save(profileID, credential.Secret{AccessKey: in.AccessKey, SecretKey: in.SecretKey}); err != nil {
		rollback := domain.ConnectionInput{
			AdapterID: current.AdapterID, Name: current.Name, Endpoint: current.Endpoint,
			Project: current.Project, Region: current.Region,
			AccessKey: currentSecret.AccessKey, SecretKey: currentSecret.SecretKey,
		}
		_ = s.store.UpdateProfile(profileID, rollback)
		return err
	}
	s.mu.Lock()
	delete(s.sessions, profileID)
	s.mu.Unlock()
	return nil
}

// DeleteProfile removes a saved connection, credentials, history, and active session.
func (s *Service) DeleteProfile(profileID int64) error {
	if profileID <= 0 {
		return errors.New("profile is required")
	}
	if _, err := s.store.Profile(profileID); err != nil {
		return err
	}
	secret, secretErr := s.credentials.Get(profileID)
	if err := s.credentials.Delete(profileID); err != nil {
		return err
	}
	if err := s.store.DeleteProfile(profileID); err != nil {
		if secretErr == nil {
			_ = s.credentials.Save(profileID, secret)
		}
		return err
	}
	s.mu.Lock()
	delete(s.sessions, profileID)
	s.mu.Unlock()
	return nil
}

// Query delegates a vendor-neutral query to the adapter for an active session.
func (s *Service) Query(q domain.QueryInput) (domain.QueryResult, error) {
	s.mu.RLock()
	in, ok := s.sessions[q.ProfileID]
	s.mu.RUnlock()
	if !ok {
		return domain.QueryResult{}, errors.New("session expired; reconnect first")
	}
	a, _ := s.registry.Get(in.AdapterID)
	result, err := a.Query(s.ctx, in, q)
	if err == nil {
		historyQuery := q.Query
		if strings.TrimSpace(result.EffectiveQuery) != "" {
			historyQuery = result.EffectiveQuery
		}
		_ = s.store.SaveQueryHistory(q.ProfileID, queryHistoryScope(q.Group, q.Logstore), historyQuery)
	}
	return result, err
}

// QueryHistory returns recently executed queries scoped to a profile and logstore.
func (s *Service) QueryHistory(profileID int64, group, logstore string) ([]domain.QueryHistoryItem, error) {
	return s.store.QueryHistory(profileID, queryHistoryScope(group, logstore), 20)
}

// queryHistoryScope prevents identically named logstores in different groups from sharing history.
func queryHistoryScope(group, logstore string) string {
	if strings.TrimSpace(group) == "" {
		return logstore
	}
	return group + "\x1f" + logstore
}
