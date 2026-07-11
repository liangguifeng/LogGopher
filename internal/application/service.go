package application

import (
	"context"
	"errors"
	"sync"

	"github.com/liangguifeng/LogGopher/internal/adapter"
	"github.com/liangguifeng/LogGopher/internal/credential"
	"github.com/liangguifeng/LogGopher/internal/domain"
	"github.com/liangguifeng/LogGopher/internal/storage"
)

type Service struct {
	store       *storage.Store
	registry    *adapter.Registry
	credentials credential.Store
	ctx         context.Context
	mu          sync.RWMutex
	sessions    map[int64]domain.ConnectionInput
}

func NewService(store *storage.Store, registry *adapter.Registry, credentials credential.Store) *Service {
	return &Service{store: store, registry: registry, credentials: credentials, ctx: context.Background(), sessions: make(map[int64]domain.ConnectionInput)}
}
func (s *Service) Start(ctx context.Context) { s.ctx = ctx }
func (s *Service) Close() error              { return s.store.Close() }
func (s *Service) Bootstrap() (domain.Bootstrap, error) {
	p, err := s.store.Profiles()
	if err != nil {
		return domain.Bootstrap{}, err
	}
	settings, err := s.store.Settings()
	return domain.Bootstrap{Adapters: s.registry.List(), Profiles: p, Settings: settings}, err
}
func (s *Service) SaveSettings(settings domain.Settings) error { return s.store.SaveSettings(settings) }
func (s *Service) Connect(in domain.ConnectionInput) (domain.Session, error) {
	a, ok := s.registry.Get(in.AdapterID)
	if !ok {
		return domain.Session{}, errors.New("unknown adapter")
	}
	logstores, err := a.Connect(s.ctx, in)
	if err != nil {
		return domain.Session{}, err
	}
	id, err := s.store.SaveProfile(in)
	if err != nil {
		return domain.Session{}, err
	}
	if in.AdapterID != "demo" {
		if err := s.credentials.Save(id, credential.Secret{AccessKey: in.AccessKey, SecretKey: in.SecretKey}); err != nil {
			return domain.Session{}, err
		}
	}
	s.mu.Lock()
	s.sessions[id] = in
	s.mu.Unlock()
	return domain.Session{ProfileID: id, Logstores: logstores}, nil
}

func (s *Service) ConnectSaved(profileID int64) (domain.Session, error) {
	profile, err := s.store.Profile(profileID)
	if err != nil {
		return domain.Session{}, err
	}
	in := domain.ConnectionInput{
		AdapterID: profile.AdapterID, Name: profile.Name, Endpoint: profile.Endpoint,
		Project: profile.Project, Region: profile.Region,
	}
	if profile.AdapterID != "demo" {
		secret, err := s.credentials.Get(profileID)
		if err != nil {
			return domain.Session{}, err
		}
		in.AccessKey, in.SecretKey = secret.AccessKey, secret.SecretKey
	}
	a, ok := s.registry.Get(in.AdapterID)
	if !ok {
		return domain.Session{}, errors.New("unknown adapter")
	}
	logstores, err := a.Connect(s.ctx, in)
	if err != nil {
		return domain.Session{}, err
	}
	s.mu.Lock()
	s.sessions[profileID] = in
	s.mu.Unlock()
	return domain.Session{ProfileID: profileID, Logstores: logstores}, nil
}
func (s *Service) Query(q domain.QueryInput) (domain.QueryResult, error) {
	s.mu.RLock()
	in, ok := s.sessions[q.ProfileID]
	s.mu.RUnlock()
	if !ok {
		return domain.QueryResult{}, errors.New("session expired; reconnect first")
	}
	a, _ := s.registry.Get(in.AdapterID)
	return a.Query(s.ctx, in, q)
}
