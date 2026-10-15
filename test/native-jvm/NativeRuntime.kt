// Executes the generated bundle with the pinned Nuvio 0.5.9 startup, URL and DOM
// bridges and dokar3 QuickJS. Only HTTP is delegated to Node's proxy-aware fetch.
import com.dokar.quickjs.quickJs
import com.dokar.quickjs.binding.function
import com.dokar.quickjs.binding.asyncFunction
import com.dokar.quickjs.binding.define
import com.nuvio.app.features.plugins.runtime.js.JsBindings
import com.nuvio.app.features.plugins.runtime.network.UrlBridge
import com.nuvio.app.features.plugins.runtime.dom.DomBridge
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import java.io.File
import java.net.URI
import java.net.http.*

fun main(args: Array<String>) { runBlocking {
    val (bundle,transport,id,type)=args.toList()
    val started=System.currentTimeMillis()
    var result="[]";var capturedAt=started;var finishedAt=started;var requests=0
    val http=HttpClient.newHttpClient()
    fun localRequest(path:String,body:String):String {
        val request=HttpRequest.newBuilder(URI(transport+path)).POST(HttpRequest.BodyPublishers.ofString(body)).build()
        return http.send(request,HttpResponse.BodyHandlers.ofString()).body()
    }
    withTimeout(60000) { quickJs(Dispatchers.Default) {
        evaluationTimeoutMillis=60000
        define("console") {
            for (name in listOf("log","warn","error","info","debug")) function(name) { a ->
                System.err.println(a.joinToString(" "));null
            }
        }
        function("__get_scraper_id") { "anime-sama" }
        function("__get_scraper_settings") { "{}" }
        function("__get_tmdb_api_key") { "" }
        function("__get_call_args") {
            JsonObject(mapOf("tmdbId" to JsonPrimitive(id),"mediaType" to JsonPrimitive(type),"season" to JsonPrimitive(1),"episode" to JsonPrimitive(1))).toString()
        }
        function("__capture_result") { a -> result=a[0].toString();capturedAt=System.currentTimeMillis();null }
        asyncFunction("__plugin_sleep") { a -> delay((a[0] as Number).toLong());null }
        UrlBridge().register(this)
        DomBridge().register(this)
        asyncFunction("__native_fetch") { a ->
            requests++
            val body=JsonArray(a.map{if(it is Boolean)JsonPrimitive(it)else JsonPrimitive(it.toString())}).toString()
            withContext(Dispatchers.IO){localRequest("/fetch",body)}
        }
        evaluate<Any?>(JsBindings.staticPolyfillCode)
        evaluate<Any?>("var module={exports:{}};var exports=module.exports;(function(){\n"+File(bundle).readText()+"\n})();")
        // This evaluate waits for native callbacks. Measure through its completion,
        // not just __capture_result, to expose canceled native timer delays.
        evaluate<Any?>(JsBindings.staticCallCode)
        finishedAt=System.currentTimeMillis()
    }}
    val streams=Json.parseToJsonElement(result).jsonArray
    val hls=streams.firstOrNull{it.jsonObject["type"]?.jsonPrimitive?.content=="hls"}
    val mediaSample=hls?.let{Json.parseToJsonElement(localRequest("/sample",it.toString()))}?:JsonNull
    val safe=JsonArray(streams.map{JsonObject(it.jsonObject.filterKeys{k->k in listOf("title","source","quality","version","type","audioLanguages","subtitleLanguages")})})
    val report=JsonObject(mapOf("id" to JsonPrimitive(id),"mediaType" to JsonPrimitive(type),"season" to JsonPrimitive(1),"episode" to JsonPrimitive(1),
        "requests" to JsonPrimitive(requests),"resultReadyMs" to JsonPrimitive(capturedAt-started),"resolveMs" to JsonPrimitive(finishedAt-started),
        "runtimeDrainMs" to JsonPrimitive(finishedAt-capturedAt),"streams" to safe,"mediaSample" to mediaSample))
    println(report)
} }
