// NuvioTV has no timer/sleep callbacks and its native HTTP binding is synchronous.
// TvBindings is generated verbatim from the checksum-pinned TV URL/DOM/polyfills.
import com.dokar.quickjs.quickJs
import com.dokar.quickjs.binding.function
import com.dokar.quickjs.binding.define
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
        val bindings=TvBindings()
        bindings.register(this)
        function("__native_fetch") { a ->
            requests++
            // Release 1.0.0 reads four arguments, maps HEAD to GET, and has no
            // bodyBase64. Mirror its text-only result rather than adding binary
            // capability from the Node test transport.
            val requested=a[1].toString().uppercase()
            val method=if(requested in listOf("POST","PUT","DELETE"))requested else "GET"
            val body=JsonArray(listOf(JsonPrimitive(a[0].toString()),JsonPrimitive(method),JsonPrimitive(a[2].toString()))).toString()
            val response=Json.parseToJsonElement(localRequest("/fetch",body)).jsonObject
            JsonObject(response.filterKeys{it!="bodyBase64"}).toString()
        }
        evaluate<Any?>(bindings.getStaticPolyfillCode())
        evaluate<Any?>("var module={exports:{}};var exports=module.exports;(function(){\n"+File(bundle).readText()+"\n})();")
        evaluate<Any?>(bindings.getStaticCallCode())
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
