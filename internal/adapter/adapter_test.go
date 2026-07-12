package adapter

import (
	"context"
	"errors"
	"testing"

	"github.com/liangguifeng/LogGopher/internal/domain"
)

func TestDefaultRegistryExposesReadyAdaptersInStableOrder(t *testing.T) {
	registry := DefaultRegistry()
	infos := registry.List()
	want := []string{"aliyun-sls", "tencent-cls", "aws-cloudwatch"}
	if len(infos) != len(want) {
		t.Fatalf("List() = %#v", infos)
	}
	for index, id := range want {
		if infos[index].ID != id || !infos[index].Ready {
			t.Fatalf("adapter[%d] = %#v", index, infos[index])
		}
		if registered, ok := registry.Get(id); !ok || registered.Info().ID != id {
			t.Fatalf("Get(%q) = %#v, %v", id, registered, ok)
		}
	}
	if _, ok := registry.Get("missing"); ok {
		t.Fatal("Get() found an unknown adapter")
	}
}

func TestStubAdapterReturnsExplicitUnsupportedErrors(t *testing.T) {
	stub := stubAdapter{info: domain.AdapterInfo{ID: "future", Name: "Future"}}
	if stub.Info().ID != "future" {
		t.Fatalf("Info() = %#v", stub.Info())
	}
	if _, err := stub.Connect(context.Background(), domain.ConnectionInput{}); !errors.Is(err, ErrNotImplemented) {
		t.Fatalf("Connect() error = %v", err)
	}
	if _, err := stub.Query(context.Background(), domain.ConnectionInput{}, domain.QueryInput{}); !errors.Is(err, ErrNotImplemented) {
		t.Fatalf("Query() error = %v", err)
	}
}
