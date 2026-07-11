package domain

import "testing"

func TestSettingsValidate(t *testing.T) {
	valid := DefaultSettings()
	if err := valid.Validate(); err != nil {
		t.Fatal(err)
	}
	invalid := valid
	invalid.Theme = "neon"
	if err := invalid.Validate(); err == nil {
		t.Fatal("expected invalid theme to be rejected")
	}
}
