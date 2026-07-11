package credential

import (
	"testing"

	keyring "github.com/zalando/go-keyring"
)

func TestKeyringStoreRoundTrip(t *testing.T) {
	keyring.MockInit()
	store := NewKeyringStore()
	want := Secret{AccessKey: "test-ak", SecretKey: "test-sk"}
	if err := store.Save(42, want); err != nil {
		t.Fatal(err)
	}
	got, err := store.Get(42)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	if err := store.Delete(42); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(42); err == nil {
		t.Fatal("expected deleted credentials to be unavailable")
	}
}
