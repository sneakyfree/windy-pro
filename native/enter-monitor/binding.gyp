{
  "targets": [
    {
      "target_name": "enter_monitor",
      "conditions": [
        ["OS=='mac'", {
          "sources": ["enter_monitor.mm"],
          "include_dirs": ["<!(node -p \"path.dirname(require.resolve('node-addon-api/package.json'))\")"],
          "defines": ["NAPI_VERSION=8", "NAPI_DISABLE_CPP_EXCEPTIONS"],
          "libraries": ["-framework Cocoa", "-framework ApplicationServices", "-framework Carbon"],
          "xcode_settings": {
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "MACOSX_DEPLOYMENT_TARGET": "10.15",
            "GCC_ENABLE_CPP_EXCEPTIONS": "NO"
          }
        }]
      ]
    }
  ]
}
