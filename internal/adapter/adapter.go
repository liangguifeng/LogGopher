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
	// Connect validates credentials and lists grouped provider logstores.
	Connect(context.Context, domain.ConnectionInput) ([]domain.LogGroup, error)
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
	r.Register(newAWSCloudWatchAdapter())
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

// stubAdapter preserves registry metadata while rejecting unavailable operations.
type stubAdapter struct{ info domain.AdapterInfo }

// Info returns metadata for an adapter whose provider implementation is unavailable.
func (a stubAdapter) Info() domain.AdapterInfo { return a.info }

// Connect returns an explicit unsupported error instead of synthetic provider data.
func (a stubAdapter) Connect(context.Context, domain.ConnectionInput) ([]domain.LogGroup, error) {
	return nil, fmt.Errorf("%s: %w", a.info.Name, ErrNotImplemented)
}

// Query returns an explicit unsupported error instead of synthetic log results.
func (a stubAdapter) Query(context.Context, domain.ConnectionInput, domain.QueryInput) (domain.QueryResult, error) {
	return domain.QueryResult{}, ErrNotImplemented
}
