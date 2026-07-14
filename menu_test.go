package main

// This file verifies native menu localization, shortcuts, and safe clipboard bridging.

import (
	"runtime"
	"strings"
	"testing"
)

func TestPasteScriptEncodesClipboardTextWithoutClipboardAPI(t *testing.T) {
	script := pasteScript("line 1\n`quoted` ${value}")
	if !strings.Contains(script, `line 1\n`) || !strings.Contains(script, "InputEvent('input'") {
		t.Fatalf("pasteScript() = %q", script)
	}
	if strings.Contains(script, "navigator.clipboard") || strings.Contains(script, "execCommand('paste") {
		t.Fatalf("pasteScript() must not invoke browser clipboard permissions: %q", script)
	}
}

func TestApplicationMenuIsLocalizedAndComplete(t *testing.T) {
	for _, test := range []struct {
		language string
		file     string
		edit     string
	}{
		{language: "zh-CN", file: "文件", edit: "编辑"},
		{language: "en-US", file: "File", edit: "Edit"},
	} {
		labels := menuLabelsFor(test.language)
		if labels.file != test.file || labels.edit != test.edit || labels.paste == "" {
			t.Fatalf("menuLabelsFor(%q) = %#v", test.language, labels)
		}
		applicationMenu := newApplicationMenu(&App{}, test.language)
		if len(applicationMenu.Items) != 6 {
			t.Fatalf("menu item count = %d", len(applicationMenu.Items))
		}
	}
}

func TestFullscreenAcceleratorMatchesPlatform(t *testing.T) {
	accelerator := fullscreenAccelerator()
	if accelerator == nil {
		t.Fatal("fullscreenAccelerator() returned nil")
	}
	if runtime.GOOS == "darwin" && len(accelerator.Modifiers) != 2 {
		t.Fatalf("macOS fullscreen modifiers = %#v", accelerator.Modifiers)
	}
}
