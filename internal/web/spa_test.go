package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

// TestSPAPwaFiles: manifest/SW/ikon diserve sebagai berkas (bukan fallback
// index) dengan MIME yang benar — syarat install PWA di Android.
func TestSPAPwaFiles(t *testing.T) {
	h := &SPAHandler{
		fileServer: http.FileServer(http.FS(mapFS())),
		fs:         mapFS(),
	}
	for path, wantCT := range map[string]string{
		"/sw.js":         "application/javascript",
		"/manifest.json": "application/json",
		"/icon-192.png":  "image/png",
		"/assets/app.js": "application/javascript",
		"/beranda":       "text/html", // client route → fallback index
		"/akun/sync/123": "text/html",
		"/api/v1/x":      "text/html", // catatan: route API dipasang sebelum SPA di router
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s = %d, mau 200", path, rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, wantCT) {
			t.Fatalf("%s content-type = %q, mau %q*", path, ct, wantCT)
		}
	}
	if !h.HasFile("/sw.js") || h.HasFile("/beranda") {
		t.Fatal("HasFile salah untuk sw.js/route SPA")
	}
}

func mapFS() fstest.MapFS {
	return fstest.MapFS{
		"index.html":    &fstest.MapFile{Data: []byte("<html></html>")},
		"sw.js":         &fstest.MapFile{Data: []byte("self.addEventListener('fetch',()=>{})")},
		"manifest.json": &fstest.MapFile{Data: []byte("{}")},
		"icon-192.png":  &fstest.MapFile{Data: []byte("\x89PNG\r\n\x1a\n")},
		"assets/app.js": &fstest.MapFile{Data: []byte("console.log(1)")},
	}
}
