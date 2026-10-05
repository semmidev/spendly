package apperr

import (
	"fmt"
	"net/http"
)

type Error struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Status  int               `json:"-"`
	Fields  map[string]string `json:"errors,omitempty"`
	Err     error             `json:"-"`
}

func (e *Error) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("[%s] %s: %v", e.Code, e.Message, e.Err)
	}
	return fmt.Sprintf("[%s] %s", e.Code, e.Message)
}

func (e *Error) Unwrap() error { return e.Err }

func (e *Error) HTTPStatusCode() int {
	if e.Status != 0 {
		return e.Status
	}
	return http.StatusInternalServerError
}

func Internal(msg string, err error) *Error {
	return &Error{Code: "INTERNAL_SERVER_ERROR", Message: msg, Status: http.StatusInternalServerError, Err: err}
}

func Invalid(msg string) *Error {
	return &Error{Code: "INVALID_INPUT", Message: msg, Status: http.StatusBadRequest}
}

func ValidationFailed(fields map[string]string) *Error {
	return &Error{Code: "VALIDATION_ERROR", Message: "validasi gagal untuk data yang dikirimkan", Status: http.StatusBadRequest, Fields: fields}
}

func NotFound(msg string) *Error {
	return &Error{Code: "NOT_FOUND", Message: msg, Status: http.StatusNotFound}
}

func Unauthorized(msg string) *Error {
	return &Error{Code: "UNAUTHORIZED", Message: msg, Status: http.StatusUnauthorized}
}

func Forbidden(msg string) *Error {
	return &Error{Code: "FORBIDDEN", Message: msg, Status: http.StatusForbidden}
}

func Conflict(msg string) *Error {
	return &Error{Code: "CONFLICT", Message: msg, Status: http.StatusConflict}
}
