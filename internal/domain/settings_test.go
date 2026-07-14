package domain

// This file verifies the complete supported settings validation matrix.

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

func TestSettingsValidationMatrix(t *testing.T) {
	for _, settings := range []Settings{
		{Theme: "invalid", Language: "zh-CN", Density: "comfortable"},
		{Theme: "system", Language: "fr-FR", Density: "comfortable"},
		{Theme: "system", Language: "zh-CN", Density: "spacious"},
	} {
		if err := settings.Validate(); err == nil {
			t.Fatalf("Validate() accepted %#v", settings)
		}
	}
	for _, theme := range []string{"system", "light", "dark"} {
		for _, language := range []string{"zh-CN", "en-US"} {
			for _, density := range []string{"comfortable", "compact"} {
				if err := (Settings{Theme: theme, Language: language, Density: density}).Validate(); err != nil {
					t.Fatalf("valid settings rejected: %v", err)
				}
			}
		}
	}
}
