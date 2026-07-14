package adapter

import (
	"context"
	"net/http"
	"strings"

	sls "github.com/aliyun/aliyun-log-go-sdk"
	"github.com/liangguifeng/LogGopher/internal/domain"
)

// newAliyunSDKClient configures credentials, cancellation, and bounded retries on the official SDK.
func newAliyunSDKClient(ctx context.Context, input domain.ConnectionInput) (aliyunSLSClient, error) {
	provider := sls.NewStaticCredentialsProvider(input.AccessKey, input.SecretKey, "")
	client := sls.CreateNormalInterfaceV2(strings.TrimSpace(input.Endpoint), provider)
	client.SetHTTPClient(&http.Client{
		Transport: contextRoundTripper{ctx: ctx, base: http.DefaultTransport},
		Timeout:   aliyunRequestTimeout,
	})
	client.SetRetryTimeout(aliyunRequestTimeout)
	return client, nil
}

// contextRoundTripper binds SDK requests to the Wails lifecycle context.
type contextRoundTripper struct {
	ctx  context.Context
	base http.RoundTripper
}

// RoundTrip forwards a cloned request that is cancelled with the adapter operation.
func (transport contextRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	if err := transport.ctx.Err(); err != nil {
		return nil, err
	}
	return transport.base.RoundTrip(request.Clone(transport.ctx))
}
