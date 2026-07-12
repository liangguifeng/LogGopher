package adapter

import (
	"context"
	"errors"
	"fmt"

	"github.com/liangguifeng/LogGopher/internal/domain"
)

// ErrNotImplemented reports that a platform adapter is visible but not connected to its SDK yet.
var ErrNotImplemented = errors.New("cloud SDK adapter is not implemented yet")

// Adapter defines the vendor-neutral contract implemented by every log platform.
type Adapter interface {
	// Info returns stable metadata without opening a provider connection.
	Info() domain.AdapterInfo
	// Connect validates credentials and lists the provider's logstores.
	Connect(context.Context, domain.ConnectionInput) ([]string, error)
	// Query maps a normalized request to the provider and normalizes its response.
	Query(context.Context, domain.ConnectionInput, domain.QueryInput) (domain.QueryResult, error)
}

// Registry stores adapters by their stable platform identifier.
type Registry struct{ items map[string]Adapter }

// DefaultRegistry returns every adapter currently exposed by the application.
func DefaultRegistry() *Registry {
	r := &Registry{items: make(map[string]Adapter)}
	r.Register(newAliyunSLSAdapter())
	r.Register(newTencentCLSAdapter())
	for _, info := range []domain.AdapterInfo{
		{ID: "aws-cloudwatch", Name: "AWS CloudWatch", Description: "CloudWatch Logs", Ready: false},
	} {
		r.Register(stubAdapter{info: info})
	}
	return r
}

// Register adds or replaces an adapter by its identifier.
func (r *Registry) Register(a Adapter) { r.items[a.Info().ID] = a }

// Get returns the adapter registered for an identifier.
func (r *Registry) Get(id string) (Adapter, bool) { a, ok := r.items[id]; return a, ok }

// List returns metadata for every registered adapter.
func (r *Registry) List() []domain.AdapterInfo {
	order := []string{"aliyun-sls", "tencent-cls", "aws-cloudwatch"}
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
