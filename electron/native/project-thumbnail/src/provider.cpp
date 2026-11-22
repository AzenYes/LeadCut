#include <windows.h>
#include <roapi.h>
#include <shobjidl.h>
#include <thumbcache.h>
#include <shlwapi.h>
#include <wincodec.h>
#include <wincrypt.h>
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.Foundation.h>
#include <algorithm>
#include <cstring>
#include <new>
#include <string>
#include <vector>

// Stream-only: Explorer never follows media paths or starts LeadCut to make a preview.
static const CLSID CLSID_LeadCutThumbnail = {0xd5a734bf,0x6859,0x4714,{0x93,0xae,0x59,0x87,0x59,0x2b,0x82,0xcc}};
static LONG objects = 0;
constexpr size_t MaxProject = 32 * 1024 * 1024;
constexpr DWORD MaxPng = 4 * 1024 * 1024;

static HRESULT Render(IStream* stream, UINT cx, HBITMAP* bitmap, WTS_ALPHATYPE* alpha) {
    LARGE_INTEGER zero{};
    HRESULT hr = stream->Seek(zero, STREAM_SEEK_SET, nullptr);
    if (FAILED(hr)) return hr;
    std::string json;
    char buffer[65536];
    for (;;) {
        ULONG read = 0;
        hr = stream->Read(buffer, sizeof(buffer), &read);
        if (FAILED(hr)) return hr;
        if (json.size() + read > MaxProject) return HRESULT_FROM_WIN32(ERROR_FILE_TOO_LARGE);
        json.append(buffer, read);
        if (!read || hr == S_FALSE) break;
    }
    if (json.compare(0, 3, "\xEF\xBB\xBF") == 0) json.erase(0, 3);
    auto project = winrt::Windows::Data::Json::JsonObject::Parse(winrt::to_hstring(json));
    auto data = project.GetNamedString(L"thumbnailPng", L"");
    constexpr wchar_t prefix[] = L"data:image/png;base64,";
    const size_t prefixLength = std::size(prefix) - 1;
    if (data.size() <= prefixLength || data.size() > MaxPng * 1.34 + 64 ||
        std::wmemcmp(data.c_str(), prefix, prefixLength) != 0) return E_FAIL;
    const wchar_t* encoded = data.c_str() + prefixLength;
    DWORD bytes = 0;
    if (!CryptStringToBinaryW(encoded, static_cast<DWORD>(data.size() - prefixLength), CRYPT_STRING_BASE64 | CRYPT_STRING_STRICT, nullptr, &bytes, nullptr, nullptr) || bytes > MaxPng || bytes < 24) return E_FAIL;
    std::vector<BYTE> png(bytes);
    if (!CryptStringToBinaryW(encoded, static_cast<DWORD>(data.size() - prefixLength), CRYPT_STRING_BASE64 | CRYPT_STRING_STRICT, png.data(), &bytes, nullptr, nullptr)) return E_FAIL;
    const BYTE signature[]{137,80,78,71,13,10,26,10};
    if (std::memcmp(png.data(), signature, sizeof(signature)) != 0) return E_FAIL;
    winrt::com_ptr<IStream> image;
    image.attach(SHCreateMemStream(png.data(), bytes));
    if (!image) return E_OUTOFMEMORY;
    winrt::com_ptr<IWICImagingFactory> factory;
    winrt::check_hresult(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(factory.put())));
    winrt::com_ptr<IWICBitmapDecoder> decoder;
    winrt::check_hresult(factory->CreateDecoder(GUID_ContainerFormatPng, nullptr, decoder.put()));
    winrt::check_hresult(decoder->Initialize(image.get(), WICDecodeMetadataCacheOnDemand));
    winrt::com_ptr<IWICBitmapFrameDecode> frame;
    winrt::check_hresult(decoder->GetFrame(0, frame.put()));
    UINT width = 0, height = 0;
    winrt::check_hresult(frame->GetSize(&width, &height));
    if (!width || !height || width > 4096 || height > 4096) return E_FAIL;
    const double scale = std::min(1.0, static_cast<double>(std::clamp(cx, 1u, 1024u)) / std::max(width, height));
    const UINT outWidth = std::max(1u, static_cast<UINT>(width * scale));
    const UINT outHeight = std::max(1u, static_cast<UINT>(height * scale));
    winrt::com_ptr<IWICBitmapScaler> scaler;
    winrt::check_hresult(factory->CreateBitmapScaler(scaler.put()));
    winrt::check_hresult(scaler->Initialize(frame.get(), outWidth, outHeight, WICBitmapInterpolationModeFant));
    winrt::com_ptr<IWICFormatConverter> converter;
    winrt::check_hresult(factory->CreateFormatConverter(converter.put()));
    winrt::check_hresult(converter->Initialize(scaler.get(), GUID_WICPixelFormat32bppPBGRA, WICBitmapDitherTypeNone, nullptr, 0, WICBitmapPaletteTypeCustom));
    BITMAPINFO info{};
    info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth = outWidth;
    info.bmiHeader.biHeight = -static_cast<LONG>(outHeight);
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB;
    void* pixels = nullptr;
    HBITMAP result = CreateDIBSection(nullptr, &info, DIB_RGB_COLORS, &pixels, nullptr, 0);
    if (!result) return E_OUTOFMEMORY;
    hr = converter->CopyPixels(nullptr, outWidth * 4, outWidth * outHeight * 4, static_cast<BYTE*>(pixels));
    if (FAILED(hr)) { DeleteObject(result); return hr; }
    *bitmap = result;
    *alpha = WTSAT_ARGB;
    return S_OK;
}

class Provider final : public IInitializeWithStream, public IThumbnailProvider {
    LONG refs = 1;
    winrt::com_ptr<IStream> stream;
public:
    Provider() { InterlockedIncrement(&objects); }
    ~Provider() { InterlockedDecrement(&objects); }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** value) override {
        if (!value) return E_POINTER;
        *value = nullptr;
        if (iid == IID_IUnknown || iid == __uuidof(IInitializeWithStream)) *value = static_cast<IInitializeWithStream*>(this);
        else if (iid == __uuidof(IThumbnailProvider)) *value = static_cast<IThumbnailProvider*>(this);
        else return E_NOINTERFACE;
        AddRef(); return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&refs); }
    ULONG STDMETHODCALLTYPE Release() override { ULONG count = InterlockedDecrement(&refs); if (!count) delete this; return count; }
    HRESULT STDMETHODCALLTYPE Initialize(IStream* input, DWORD) override {
        if (!input) return E_INVALIDARG;
        if (stream) return HRESULT_FROM_WIN32(ERROR_ALREADY_INITIALIZED);
        stream.copy_from(input); return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GetThumbnail(UINT cx, HBITMAP* bitmap, WTS_ALPHATYPE* alpha) override {
        if (!bitmap || !alpha) return E_POINTER;
        *bitmap = nullptr; *alpha = WTSAT_UNKNOWN;
        if (!stream || !cx) return E_INVALIDARG;
        const HRESULT initialized = RoInitialize(RO_INIT_MULTITHREADED);
        HRESULT result;
        try { result = Render(stream.get(), cx, bitmap, alpha); }
        catch (...) { result = winrt::to_hresult(); }
        if (SUCCEEDED(initialized)) RoUninitialize();
        return result;
    }
};

class Factory final : public IClassFactory {
    LONG refs = 1;
public:
    Factory() { InterlockedIncrement(&objects); }
    ~Factory() { InterlockedDecrement(&objects); }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** value) override {
        if (!value) return E_POINTER;
        *value = nullptr;
        if (iid != IID_IUnknown && iid != IID_IClassFactory) return E_NOINTERFACE;
        *value = static_cast<IClassFactory*>(this); AddRef(); return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&refs); }
    ULONG STDMETHODCALLTYPE Release() override { ULONG count = InterlockedDecrement(&refs); if (!count) delete this; return count; }
    HRESULT STDMETHODCALLTYPE CreateInstance(IUnknown* outer, REFIID iid, void** value) override {
        if (!value) return E_POINTER;
        *value = nullptr;
        if (outer) return CLASS_E_NOAGGREGATION;
        auto object = new(std::nothrow) Provider();
        if (!object) return E_OUTOFMEMORY;
        HRESULT hr = object->QueryInterface(iid, value); object->Release(); return hr;
    }
    HRESULT STDMETHODCALLTYPE LockServer(BOOL lock) override {
        if (lock) InterlockedIncrement(&objects); else InterlockedDecrement(&objects); return S_OK;
    }
};

extern "C" HRESULT __stdcall DllGetClassObject(REFCLSID clsid, REFIID iid, void** value) {
    if (!value) return E_POINTER;
    *value = nullptr;
    if (clsid != CLSID_LeadCutThumbnail) return CLASS_E_CLASSNOTAVAILABLE;
    auto factory = new(std::nothrow) Factory();
    if (!factory) return E_OUTOFMEMORY;
    HRESULT hr = factory->QueryInterface(iid, value); factory->Release(); return hr;
}
extern "C" HRESULT __stdcall DllCanUnloadNow() { return objects == 0 ? S_OK : S_FALSE; }
