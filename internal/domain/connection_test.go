package domain

import "testing"

func TestAWSConnectionRequiresRegion(t *testing.T) {
	input := ConnectionInput{
		AdapterID: "aws-cloudwatch", Name: "production",
		Endpoint:  "https://logs.us-east-1.amazonaws.com",
		AccessKey: "test-access-key", SecretKey: "test-secret-key",
	}
	if err := input.Validate(); err == nil {
		t.Fatal("Validate() accepted an AWS connection without region")
	}
	input.Region = "us-east-1"
	if err := input.Validate(); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
}

func TestConnectionValidationMatrix(t *testing.T) {
	valid := ConnectionInput{
		AdapterID: "aliyun-sls", Name: "production", Endpoint: "https://example.com",
		AccessKey: "access", SecretKey: "secret",
	}
	tests := []struct {
		name   string
		mutate func(*ConnectionInput)
	}{
		{name: "missing adapter", mutate: func(input *ConnectionInput) { input.AdapterID = "" }},
		{name: "missing alias", mutate: func(input *ConnectionInput) { input.Name = "" }},
		{name: "invalid endpoint", mutate: func(input *ConnectionInput) { input.Endpoint = "file:///tmp/log" }},
		{name: "missing access key", mutate: func(input *ConnectionInput) { input.AccessKey = "" }},
		{name: "missing secret key", mutate: func(input *ConnectionInput) { input.SecretKey = "" }},
		{name: "CLS missing region", mutate: func(input *ConnectionInput) { input.AdapterID = "tencent-cls" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := valid
			test.mutate(&input)
			if err := input.Validate(); err == nil {
				t.Fatalf("Validate() accepted %#v", input)
			}
		})
	}
	if err := valid.Validate(); err != nil {
		t.Fatalf("valid connection rejected: %v", err)
	}
}
