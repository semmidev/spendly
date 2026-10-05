package gmail

import (
	"context"
	"fmt"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	gmailapi "google.golang.org/api/gmail/v1"
	"google.golang.org/api/option"
)

// Client membungkus Gmail API read-only dengan refresh otomatis.
// Refresh token disimpan terenkripsi di DB (PLAN §2.2); access token di memori.
type Client struct{ svc *gmailapi.Service }

func New(ctx context.Context, clientID, secret, refreshToken string) (*Client, error) {
	cfg := &oauth2.Config{ClientID: clientID, ClientSecret: secret, Endpoint: google.Endpoint}
	ts := cfg.TokenSource(ctx, &oauth2.Token{RefreshToken: refreshToken})
	svc, err := gmailapi.NewService(ctx, option.WithTokenSource(ts))
	if err != nil {
		return nil, err
	}
	return &Client{svc: svc}, nil
}

// ListIDs mengembalikan id pesan untuk query Gmail (max 100/halaman).
func (c *Client) ListIDs(ctx context.Context, query, pageToken string) (ids []string, next string, err error) {
	call := c.svc.Users.Messages.List("me").Q(query).MaxResults(100).Context(ctx)
	if pageToken != "" {
		call.PageToken(pageToken)
	}
	var lastErr error
	for attempt := 0; attempt < 4; attempt++ {
		res, e := call.Do()
		if e == nil {
			for _, m := range res.Messages {
				ids = append(ids, m.Id)
			}
			return ids, res.NextPageToken, nil
		}
		lastErr = e
		sleepBackoff(ctx, attempt)
	}
	return nil, "", fmt.Errorf("gmail list: %w", lastErr)
}

// Get mengambil pesan penuh (format full).
func (c *Client) Get(ctx context.Context, id string) (*gmailapi.Message, error) {
	var msg *gmailapi.Message
	var lastErr error
	for attempt := 0; attempt < 4; attempt++ {
		m, e := c.svc.Users.Messages.Get("me", id).Format("full").Context(ctx).Do()
		if e == nil {
			return m, nil
		}
		msg = m
		lastErr = e
		sleepBackoff(ctx, attempt)
	}
	_ = msg
	return nil, fmt.Errorf("gmail get: %w", lastErr)
}

// GetMetadata mengambil header saja (From, Subject, Date) untuk discover.
func (c *Client) GetMetadata(ctx context.Context, id string) (*gmailapi.Message, error) {
	return c.svc.Users.Messages.Get("me", id).
		Format("metadata").MetadataHeaders("From", "Subject", "Date").Context(ctx).Do()
}

// HistoryIDNow mengambil cursor historyId profil saat ini.
func (c *Client) HistoryIDNow(ctx context.Context) (uint64, error) {
	p, err := c.svc.Users.GetProfile("me").Context(ctx).Do()
	if err != nil {
		return 0, err
	}
	return p.HistoryId, nil
}

// HistoryAdded mengembalikan id pesan baru sejak historyId (messageAdded).
func (c *Client) HistoryAdded(ctx context.Context, historyID uint64) (ids []string, newHistoryID uint64, expired bool, err error) {
	var pageToken string
	for {
		call := c.svc.Users.History.List("me").StartHistoryId(historyID).
			HistoryTypes("messageAdded").Context(ctx)
		if pageToken != "" {
			call.PageToken(pageToken)
		}
		res, e := call.Do()
		if e != nil {
			// 404 = historyId kedaluwarsa → fallback list ulang (PLAN §3.2)
			return ids, 0, true, nil
		}
		for _, h := range res.History {
			for _, m := range h.MessagesAdded {
				if m.Message != nil {
					ids = append(ids, m.Message.Id)
				}
			}
		}
		newHistoryID = res.HistoryId
		if res.NextPageToken == "" {
			break
		}
		pageToken = res.NextPageToken
	}
	return ids, newHistoryID, false, nil
}

func sleepBackoff(ctx context.Context, attempt int) {
	d := time.Duration(200*(1<<attempt)) * time.Millisecond
	if d > 3*time.Second {
		d = 3 * time.Second
	}
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}
