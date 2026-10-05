// Package web menyajikan frontend React (SPA) yang di-embed ke binary Go,
// sehingga satu proses `spendly` melayani API + UI tanpa menjalankan
package web

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed all:dist
var FS embed.FS

// DistFS mengembalikan filesystem yang berakar pada "dist".
func DistFS() (fs.FS, error) {
	return fs.Sub(FS, "dist")
}

// SPAHandler melayani SPA hasil build dengan fallback index.html (client routing).
type SPAHandler struct {
	fileServer http.Handler
	fs         fs.FS
}

func NewSPAHandler() (*SPAHandler, error) {
	distFS, err := DistFS()
	if err != nil {
		return nil, err
	}
	return &SPAHandler{fileServer: http.FileServer(http.FS(distFS)), fs: distFS}, nil
}

// HasFile true bila path menunjuk berkas (bukan direktori) di dist.
func (h *SPAHandler) HasFile(urlPath string) bool {
	filePath := strings.TrimPrefix(urlPath, "/")
	if filePath == "" {
		filePath = "index.html"
	}
	stat, err := fs.Stat(h.fs, filePath)
	return err == nil && !stat.IsDir()
}

func (h *SPAHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	urlPath := r.URL.Path
	if urlPath == "/" {
		urlPath = "/index.html"
	}
	filePath := strings.TrimPrefix(urlPath, "/")

	file, err := h.fs.Open(filePath)
	if err != nil {
		h.serveIndex(w, r)
		return
	}
	_ = file.Close()

	stat, err := fs.Stat(h.fs, filePath)
	if err != nil || stat.IsDir() {
		h.serveIndex(w, r)
		return
	}

	// Jangan cache UI/aset sama sekali: setiap rebuild harus langsung terlihat,
	// tanpa perlu hard-reload. (Aplikasi kecil; biaya refetch dapat diterima.)
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	h.fileServer.ServeHTTP(w, r)
}

func (h *SPAHandler) serveIndex(w http.ResponseWriter, r *http.Request) {
	data, err := fs.ReadFile(h.fs, "index.html")
	if err != nil {
		http.Error(w, "Index not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	_, _ = w.Write(data)
}

// IsFrontendBundled true bila index.html ter-embed (frontend sudah di-build).
func IsFrontendBundled() bool {
	_, err := FS.ReadFile("dist/index.html")
	return err == nil
}
