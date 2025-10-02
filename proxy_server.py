#!/usr/bin/env python3
"""
Simple proxy server to handle CORS issues with images
"""
import http.server
import socketserver
import urllib.request
import urllib.parse
from urllib.error import URLError
import json

class ProxyHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/proxy/'):
            # Extract the actual URL from the proxy path
            actual_url = self.path[7:]  # Remove '/proxy/' prefix
            actual_url = urllib.parse.unquote(actual_url)
            
            try:
                # Fetch the image
                req = urllib.request.Request(actual_url)
                req.add_header('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')
                
                with urllib.request.urlopen(req) as response:
                    # Get content type
                    content_type = response.headers.get('Content-Type', 'image/jpeg')
                    
                    # Send response headers
                    self.send_response(200)
                    self.send_header('Content-Type', content_type)
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.send_header('Access-Control-Allow-Methods', 'GET')
                    self.send_header('Access-Control-Allow-Headers', 'Content-Type')
                    self.send_header('Cache-Control', 'public, max-age=3600')
                    self.end_headers()
                    
                    # Send image data
                    self.wfile.write(response.read())
                    
            except URLError as e:
                self.send_response(404)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                error_response = json.dumps({'error': f'Failed to fetch image: {str(e)}'})
                self.wfile.write(error_response.encode())
        else:
            # Serve static files normally
            super().do_GET()
    
    def do_OPTIONS(self):
        # Handle CORS preflight requests
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

if __name__ == "__main__":
    PORT = 8099
    
    with socketserver.TCPServer(("127.0.0.1", PORT), ProxyHandler) as httpd:
        print(f"Proxy server running at http://127.0.0.1:{PORT}/")
        print("Use /proxy/URL to fetch images through proxy")
        httpd.serve_forever()
