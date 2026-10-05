package web

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/semmidev/spendly/internal/platform/apperr"
)

type ctxKey int

const userIDKey ctxKey = iota + 1

type Response struct {
	Success bool              `json:"success"`
	Code    string            `json:"code,omitempty"`
	Message string            `json:"message"`
	Data    any               `json:"data,omitempty"`
	Meta    any               `json:"meta,omitempty"`
	Errors  map[string]string `json:"errors,omitempty"`
}

func Success(w http.ResponseWriter, status int, message string, data any, meta any) {
	if message == "" {
		message = "OK"
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(Response{Success: true, Message: message, Data: data, Meta: meta})
}

func JSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(Response{Success: true, Message: "OK", Data: data})
}

func Error(w http.ResponseWriter, _ *http.Request, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store, max-age=0")
	var appErr *apperr.Error
	if errors.As(err, &appErr) {
		w.WriteHeader(appErr.HTTPStatusCode())
		_ = json.NewEncoder(w).Encode(Response{Success: false, Code: appErr.Code, Message: appErr.Message, Errors: appErr.Fields})
		return
	}
	w.WriteHeader(http.StatusInternalServerError)
	_ = json.NewEncoder(w).Encode(Response{Success: false, Code: "INTERNAL_SERVER_ERROR", Message: "internal server error"})
}

func Decode(r *http.Request, dst any) error {
	if r.Body == nil {
		return apperr.Invalid("body permintaan tidak boleh kosong")
	}
	defer func() { _ = r.Body.Close() }()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return apperr.Invalid("body JSON tidak valid: " + err.Error())
	}
	return nil
}

func DecodeTyped[T any](r *http.Request) (T, error) {
	var dst T
	return dst, Decode(r, &dst)
}

func WithUser(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, userIDKey, userID)
}

func UserID(ctx context.Context) (string, bool) {
	id, ok := ctx.Value(userIDKey).(string)
	return id, ok
}
