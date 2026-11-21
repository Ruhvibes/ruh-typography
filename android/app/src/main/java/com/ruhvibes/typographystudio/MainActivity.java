package com.ruhvibes.typographystudio;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;

/**
 * RuhTypographyStudio — original kinetic typography studio.
 * Thin native wrapper: a full-screen WebView loads the local web app
 * (file:///android_asset/www/index.html). All creative logic lives in
 * JavaScript; the native side exposes only device capabilities:
 *
 *   Android.ttsGetVoices()            — JSON list of installed TTS voices.
 *   Android.ttsSpeak(text, locale)    — preview speech aloud.
 *   Android.ttsSave(text, locale, fileName) — synthesize to a WAV file;
 *                                       JS gets onTtsSaved({ok, path}) or
 *                                       onTtsSaved({ok:false, reason}).
 *   Android.sttStart(locale)          — live speech recognition (mic);
 *                                       partial + final results arrive via
 *                                       JS onSttResult({text, final, t}).
 *   Android.sttStop()                 — stop listening.
 *   Android.saveFile(base64, name, mime) — save a file to Downloads;
 *                                       JS gets onFileSaved({ok, uri}).
 *   Android.shareFile(path, mime)     — system share sheet (FileProvider).
 *   Android.toast(msg)                — short toast.
 */
public class MainActivity extends ComponentActivity {

    private static final int REQ_AUDIO = 1001;
    private static final int REQ_FILE = 1002;

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private TextToSpeech tts;
    private SpeechRecognizer recognizer;
    private boolean listening = false;
    private long listenStartMs = 0;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setTheme(android.R.style.Theme_Material_NoActionBar);
        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = params.createIntent();
                try {
                    startActivityForResult(intent, REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                        .setPositiveButton("OK", (d, w) -> result.confirm()).setCancelable(false).show();
                return true;
            }
            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                        .setPositiveButton("Yes", (d, w) -> result.confirm())
                        .setNegativeButton("No", (d, w) -> result.cancel()).show();
                return true;
            }
            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
                final EditText input = new EditText(MainActivity.this);
                input.setText(defaultValue);
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setView(input)
                        .setPositiveButton("OK", (d, w) -> result.confirm(input.getText().toString()))
                        .setNegativeButton("Cancel", (d, w) -> result.cancel()).show();
                return true;
            }
        });
        webView.addJavascriptInterface(new Bridge(), "Android");
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    private void js(String script) {
        mainHandler.post(() -> {
            if (webView != null) webView.evaluateJavascript(script, null);
        });
    }

    private void jsCallback(String fn, JSONObject obj) {
        js("window." + fn + " && window." + fn + "(" + obj.toString() + ");");
    }

    private void ensureTts(final Runnable ready) {
        if (tts != null) { ready.run(); return; }
        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) ready.run();
            else {
                tts = null;
                toast("Text-to-speech is not available on this device");
            }
        });
    }

    private Locale localeFor(String tag) {
        if (tag == null || tag.isEmpty()) return Locale.US;
        String[] parts = tag.replace('-', '_').split("_");
        if (parts.length >= 2) return new Locale(parts[0], parts[1]);
        return new Locale(parts[0]);
    }

    private void toast(String msg) {
        mainHandler.post(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE && fileCallback != null) {
            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            fileCallback.onReceiveValue(results);
            fileCallback = null;
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_AUDIO) {
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            try {
                JSONObject o = new JSONObject();
                o.put("granted", granted);
                jsCallback("onMicPermission", o);
            } catch (Exception ignored) {}
        }
    }

    @Override
    protected void onDestroy() {
        if (recognizer != null) { try { recognizer.destroy(); } catch (Exception ignored) {} }
        if (tts != null) { try { tts.shutdown(); } catch (Exception ignored) {} }
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    private class Bridge {

        @JavascriptInterface
        public void toast(String msg) {
            MainActivity.this.toast(msg);
        }

        @JavascriptInterface
        public String ttsGetVoices() {
            final String[] out = new String[]{ "[]" };
            final java.util.concurrent.CountDownLatch latch =
                    new java.util.concurrent.CountDownLatch(1);
            ensureTts(() -> {
                try {
                    JSONArray arr = new JSONArray();
                    for (android.speech.tts.Voice v : tts.getVoices()) {
                        JSONObject o = new JSONObject();
                        o.put("name", v.getName());
                        o.put("locale", v.getLocale().toLanguageTag());
                        arr.put(o);
                    }
                    out[0] = arr.toString();
                } catch (Exception e) {
                    out[0] = "[]";
                }
                latch.countDown();
            });
            try { latch.await(8, java.util.concurrent.TimeUnit.SECONDS); } catch (Exception ignored) {}
            return out[0];
        }

        @JavascriptInterface
        public void ttsSpeak(String text, String localeTag) {
            ensureTts(() -> {
                tts.setLanguage(localeFor(localeTag));
                tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "preview");
            });
        }

        @JavascriptInterface
        public void ttsSave(String text, String localeTag, String fileName) {
            ensureTts(() -> {
                tts.setLanguage(localeFor(localeTag));
                File dir = new File(getCacheDir(), "share");
                if (!dir.exists()) dir.mkdirs();
                String safe = fileName.replaceAll("[^A-Za-z0-9._-]", "_");
                if (!safe.toLowerCase().endsWith(".wav")) safe += ".wav";
                final String safeName = safe;
                File out = new File(dir, safe);
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) {}
                    @Override public void onError(String id) { fail("Speech synthesis failed"); }
                    @Override public void onDone(String id) {
                        try {
                            JSONObject o = new JSONObject();
                            o.put("ok", true);
                            o.put("path", "file://" + out.getAbsolutePath());
                            o.put("name", safeName);
                            jsCallback("onTtsSaved", o);
                        } catch (Exception ignored) {}
                    }
                    private void fail(String reason) {
                        try {
                            JSONObject o = new JSONObject();
                            o.put("ok", false);
                            o.put("reason", reason);
                            jsCallback("onTtsSaved", o);
                        } catch (Exception ignored) {}
                    }
                });
                int r = tts.synthesizeToFile(text, null, out, "save");
                if (r != TextToSpeech.SUCCESS) {
                    try {
                        JSONObject o = new JSONObject();
                        o.put("ok", false);
                        o.put("reason", "Speech synthesis failed to start");
                        jsCallback("onTtsSaved", o);
                    } catch (Exception ignored) {}
                }
            });
        }

        @JavascriptInterface
        public void sttStart(String localeTag) {
            if (ContextCompat.checkSelfPermission(MainActivity.this,
                    Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(MainActivity.this,
                        new String[]{ Manifest.permission.RECORD_AUDIO }, REQ_AUDIO);
                return;
            }
            startListening(localeTag);
        }

        @JavascriptInterface
        public void sttStop() {
            if (recognizer != null && listening) {
                try { recognizer.stopListening(); } catch (Exception ignored) {}
            }
        }

        @JavascriptInterface
        public void saveFile(String base64, String fileName, String mime) {
            new Thread(() -> {
                try {
                    byte[] data = Base64.decode(base64, Base64.DEFAULT);
                    String safe = fileName.replaceAll("[^A-Za-z0-9._-]", "_");
                    Uri uri;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        ContentValues values = new ContentValues();
                        values.put(MediaStore.MediaColumns.DISPLAY_NAME, safe);
                        values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                        values.put(MediaStore.MediaColumns.RELATIVE_PATH,
                                Environment.DIRECTORY_DOWNLOADS + "/RuhTypographyStudio");
                        uri = getContentResolver().insert(
                                MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                        try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                            os.write(data);
                        }
                    } else {
                        File dir = new File(Environment.getExternalStoragePublicDirectory(
                                Environment.DIRECTORY_DOWNLOADS), "RuhTypographyStudio");
                        if (!dir.exists()) dir.mkdirs();
                        File f = new File(dir, safe);
                        try (FileOutputStream fos = new FileOutputStream(f)) {
                            fos.write(data);
                        }
                        uri = Uri.fromFile(f);
                    }
                    JSONObject o = new JSONObject();
                    o.put("ok", true);
                    o.put("uri", uri.toString());
                    o.put("name", safe);
                    jsCallback("onFileSaved", o);
                } catch (Exception e) {
                    try {
                        JSONObject o = new JSONObject();
                        o.put("ok", false);
                        o.put("reason", e.getMessage());
                        jsCallback("onFileSaved", o);
                    } catch (Exception ignored) {}
                }
            }).start();
        }

        @JavascriptInterface
        public void shareFile(String path, String mime) {
            try {
                File f = new File(Uri.parse(path).getPath());
                Uri uri = FileProvider.getUriForFile(MainActivity.this,
                        "com.ruhvibes.typographystudio.fileprovider", f);
                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType(mime);
                intent.putExtra(Intent.EXTRA_STREAM, uri);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(Intent.createChooser(intent, "Share"));
            } catch (Exception e) {
                toast("Could not share this file");
            }
        }
    }

    private void startListening(String localeTag) {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            toast("Speech recognition is not available on this device");
            return;
        }
        if (recognizer == null) recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, localeFor(localeTag).toLanguageTag());
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        listenStartMs = System.currentTimeMillis();
        listening = true;
        recognizer.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle p) {}
            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float v) {}
            @Override public void onBufferReceived(byte[] b) {}
            @Override public void onEndOfSpeech() {}
            @Override public void onError(int err) {
                listening = false;
                sendResult("", true, err);
            }
            @Override public void onResults(Bundle results) {
                listening = false;
                ArrayList<String> list = results.getStringArrayList(
                        SpeechRecognizer.RESULTS_RECOGNITION);
                if (list != null && !list.isEmpty()) sendResult(list.get(0), true, 0);
                else sendResult("", true, 0);
            }
            @Override public void onPartialResults(Bundle results) {
                ArrayList<String> list = results.getStringArrayList(
                        SpeechRecognizer.RESULTS_RECOGNITION);
                if (list != null && !list.isEmpty()) sendResult(list.get(0), false, 0);
            }
            @Override public void onEvent(int type, Bundle p) {}
            private void sendResult(String text, boolean isFinal, int err) {
                try {
                    JSONObject o = new JSONObject();
                    o.put("text", text);
                    o.put("isFinal", isFinal);
                    o.put("error", err);
                    o.put("t", (System.currentTimeMillis() - listenStartMs) / 1000.0);
                    jsCallback("onSttResult", o);
                } catch (Exception ignored) {}
            }
        });
        recognizer.startListening(intent);
    }
}
