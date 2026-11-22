#include "wgc_session.h"

#include <windows.graphics.capture.interop.h>
#include <Windows.Graphics.Capture.h>
#include <dwmapi.h>
#include <inspectable.h>

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.System.h>

#include <iostream>
#include <chrono>
#include <algorithm>
#include <cmath>
#include <thread>

// IDirect3DDxgiInterfaceAccess is a COM interface for getting the DXGI interface
// from a WinRT IDirect3DSurface
MIDL_INTERFACE("A9B3D012-3DF2-4EE3-B8D1-8695F457D3C1")
IDirect3DDxgiInterfaceAccess : public IUnknown {
    virtual HRESULT STDMETHODCALLTYPE GetInterface(REFIID iid, void** p) = 0;
};

// Convert ID3D11Device → IDirect3DDevice (WinRT interop)
extern "C" {
    HRESULT __stdcall CreateDirect3D11DeviceFromDXGIDevice(
        IDXGIDevice* dxgiDevice,
        IInspectable** graphicsDevice);
}

static int normalizeFramePoolExtent(int value) {
    int normalized = value < 2 ? 2 : value;
    if ((normalized % 2) != 0) ++normalized;
    return normalized;
}

WgcSession::WgcSession() {}

WgcSession::~WgcSession() {
    stopCapture();
}

bool WgcSession::createD3DDevice(HMONITOR monitor) {
    D3D_FEATURE_LEVEL featureLevels[] = {
        D3D_FEATURE_LEVEL_11_1,
        D3D_FEATURE_LEVEL_11_0,
    };

    // Desktop Duplication requires a device on the adapter that owns the output.
    ComPtr<IDXGIAdapter1> captureAdapter;
    ComPtr<IDXGIFactory1> factory;
    if (SUCCEEDED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) {
        for (UINT adapterIndex = 0; !captureAdapter; ++adapterIndex) {
            ComPtr<IDXGIAdapter1> adapter;
            if (FAILED(factory->EnumAdapters1(adapterIndex, &adapter))) break;
            for (UINT outputIndex = 0; ; ++outputIndex) {
                ComPtr<IDXGIOutput> output;
                if (FAILED(adapter->EnumOutputs(outputIndex, &output))) break;
                DXGI_OUTPUT_DESC desc{};
                if (SUCCEEDED(output->GetDesc(&desc)) && desc.Monitor == monitor) {
                    captureAdapter = adapter;
                    output.As(&captureOutput_);
                    break;
                }
            }
        }
    }

    HRESULT hr = D3D11CreateDevice(
        captureAdapter.Get(),
        captureAdapter ? D3D_DRIVER_TYPE_UNKNOWN : D3D_DRIVER_TYPE_HARDWARE,
        nullptr,
        D3D11_CREATE_DEVICE_BGRA_SUPPORT,
        featureLevels,
        ARRAYSIZE(featureLevels),
        D3D11_SDK_VERSION,
        &d3dDevice_,
        nullptr,
        &d3dContext_);

    if (FAILED(hr)) {
        std::cerr << "ERROR: D3D11CreateDevice failed: 0x" << std::hex << hr << std::endl;
        return false;
    }

    return true;
}

winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice WgcSession::createWinRTDevice() {
    ComPtr<IDXGIDevice> dxgiDevice;
    HRESULT hr = d3dDevice_.As(&dxgiDevice);
    if (FAILED(hr)) return nullptr;

    winrt::com_ptr<IInspectable> inspectable;
    hr = CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice.Get(), inspectable.put());
    if (FAILED(hr)) return nullptr;

    return inspectable.as<winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice>();
}

winrt::Windows::Graphics::Capture::GraphicsCaptureItem WgcSession::createCaptureItemForMonitor(HMONITOR monitor) {
    auto factory = winrt::get_activation_factory<
        winrt::Windows::Graphics::Capture::GraphicsCaptureItem>();

    auto interop = factory.as<IGraphicsCaptureItemInterop>();

    winrt::Windows::Graphics::Capture::GraphicsCaptureItem item{nullptr};
    HRESULT hr = interop->CreateForMonitor(
        monitor,
        winrt::guid_of<ABI::Windows::Graphics::Capture::IGraphicsCaptureItem>(),
        winrt::put_abi(item));

    if (FAILED(hr)) {
        std::cerr << "ERROR: CreateForMonitor failed: 0x" << std::hex << hr << std::endl;
        return nullptr;
    }

    return item;
}

bool WgcSession::initializeWithItem(int fps) {
    if (!captureItem_) return false;

    auto size = captureItem_.Size();
    captureWidth_ = size.Width;
    captureHeight_ = size.Height;
    framePoolWidth_ = size.Width;
    framePoolHeight_ = size.Height;

    framePool_ = winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool::CreateFreeThreaded(
        winrtDevice_,
        winrt::Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized,
        2,
        size);

    session_ = framePool_.CreateCaptureSession(captureItem_);

    session_.IsCursorCaptureEnabled(false);

    // IsBorderRequired is only available on Windows 11+ (build 22000). propagating an hresult_error results in Native Windows capture failure
    try {
        session_.IsBorderRequired(false);
    } catch (winrt::hresult_error const&) {
    }

    return true;
}

bool WgcSession::recreateFramePoolIfNeeded(
    winrt::Windows::Graphics::SizeInt32 const& contentSize) {
    if (!framePool_) return false;

    const int normalizedWidth = normalizeFramePoolExtent(contentSize.Width);
    const int normalizedHeight = normalizeFramePoolExtent(contentSize.Height);
    if (normalizedWidth == framePoolWidth_ && normalizedHeight == framePoolHeight_) {
        return false;
    }

    winrt::Windows::Graphics::SizeInt32 normalizedSize{
        normalizedWidth,
        normalizedHeight,
    };

    try {
        framePool_.Recreate(
            winrtDevice_,
            winrt::Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            normalizedSize);
        framePoolWidth_ = normalizedWidth;
        framePoolHeight_ = normalizedHeight;
        std::cerr << "INFO: Recreated WGC frame pool for resized content "
                  << framePoolWidth_ << "x" << framePoolHeight_ << std::endl;
    } catch (winrt::hresult_error const& e) {
        fatalError_ = true;
        capturing_ = false;
        std::cerr << "ERROR: Failed to recreate WGC frame pool after resize: 0x"
                  << std::hex << e.code() << std::dec << std::endl;
    }

    return true;
}

bool WgcSession::initialize(HMONITOR monitor, int fps) {
    fps_ = fps;
    frameIntervalHns_ = 10000000LL / fps_;

    if (!createD3DDevice(monitor)) return false;

    winrtDevice_ = createWinRTDevice();
    if (!winrtDevice_) {
        std::cerr << "ERROR: Failed to create WinRT D3D device" << std::endl;
        return false;
    }

    captureItem_ = createCaptureItemForMonitor(monitor);
    return initializeWithItem(fps);
}

bool WgcSession::initialize(HWND hwnd, int fps) {
    fps_ = fps;
    frameIntervalHns_ = 10000000LL / fps_;

    HMONITOR monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
    if (!monitor) return false;
    if (!createD3DDevice(monitor)) return false;

    winrtDevice_ = createWinRTDevice();
    if (!winrtDevice_) {
        std::cerr << "ERROR: Failed to create WinRT D3D device" << std::endl;
        return false;
    }

    captureItem_ = createCaptureItemForMonitor(monitor);
    return initializeWithItem(fps) && initializeWindowCrop(hwnd);
}

bool WgcSession::initializeWindowCrop(HWND hwnd) {
    windowHandle_ = hwnd;
    MONITORINFO monitorInfo{};
    monitorInfo.cbSize = sizeof(monitorInfo);
    if (!GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), &monitorInfo)) return false;
    monitorBounds_ = monitorInfo.rcMonitor;

    return updateWindowCropRect(true);
}

bool WgcSession::updateWindowCropRect(bool initializeSize) {
    RECT windowBounds{};
    if (FAILED(DwmGetWindowAttribute(windowHandle_, DWMWA_EXTENDED_FRAME_BOUNDS, &windowBounds, sizeof(windowBounds))) &&
        !GetWindowRect(windowHandle_, &windowBounds)) return false;
    RECT clipped{};
    if (!IntersectRect(&clipped, &windowBounds, &monitorBounds_)) return false;

    const LONG monitorWidth = monitorBounds_.right - monitorBounds_.left;
    const LONG monitorHeight = monitorBounds_.bottom - monitorBounds_.top;
    if (monitorWidth <= 0 || monitorHeight <= 0 || framePoolWidth_ < 2 || framePoolHeight_ < 2) return false;

    // WGC textures are in capture-surface pixels, while Win32 monitor/window
    // rectangles can be DPI-virtualized. Map both edges into texture space
    // instead of assuming those coordinate systems are identical.
    const auto mapX = [this, monitorWidth](LONG desktopX) {
        const double normalized = static_cast<double>(desktopX - monitorBounds_.left) /
            static_cast<double>(monitorWidth);
        return std::clamp(
            static_cast<LONG>(std::llround(normalized * framePoolWidth_)),
            0L,
            static_cast<LONG>(framePoolWidth_));
    };
    const auto mapY = [this, monitorHeight](LONG desktopY) {
        const double normalized = static_cast<double>(desktopY - monitorBounds_.top) /
            static_cast<double>(monitorHeight);
        return std::clamp(
            static_cast<LONG>(std::llround(normalized * framePoolHeight_)),
            0L,
            static_cast<LONG>(framePoolHeight_));
    };

    LONG left = mapX(clipped.left);
    LONG top = mapY(clipped.top);
    LONG right = mapX(clipped.right);
    LONG bottom = mapY(clipped.bottom);
    const LONG mappedWidth = (right - left) & ~1L;
    const LONG mappedHeight = (bottom - top) & ~1L;
    if (mappedWidth < 2 || mappedHeight < 2) return false;

    if (initializeSize) {
        captureWidth_ = static_cast<int>(mappedWidth);
        captureHeight_ = static_cast<int>(mappedHeight);

        D3D11_TEXTURE2D_DESC desc{};
        desc.Width = static_cast<UINT>(captureWidth_);
        desc.Height = static_cast<UINT>(captureHeight_);
        desc.MipLevels = 1;
        desc.ArraySize = 1;
        desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
        desc.SampleDesc.Count = 1;
        desc.Usage = D3D11_USAGE_DEFAULT;
        desc.BindFlags = D3D11_BIND_RENDER_TARGET;

        ComPtr<ID3D11Texture2D> resizedTexture;
        if (FAILED(d3dDevice_->CreateTexture2D(&desc, nullptr, &resizedTexture))) return false;
        ComPtr<ID3D11RenderTargetView> renderTargetView;
        if (FAILED(d3dDevice_->CreateRenderTargetView(resizedTexture.Get(), nullptr, &renderTargetView))) return false;
        cropTexture_ = resizedTexture;
        cropRenderTargetView_ = renderTargetView;
    }

    if (!cropTexture_ || !cropRenderTargetView_) return false;

    // The encoder's dimensions are fixed for the lifetime of the MP4. Keep the
    // crop texture fixed too: reallocating it after a resize made the encoder
    // pad the changed frame with black bars. If the selected window shrinks,
    // copy only its current area so the crop never exposes nearby desktop pixels.
    const LONG copyWidth = (std::min)(mappedWidth, static_cast<LONG>(captureWidth_));
    const LONG copyHeight = (std::min)(mappedHeight, static_cast<LONG>(captureHeight_));
    left = std::clamp(left, 0L, static_cast<LONG>(framePoolWidth_) - copyWidth);
    top = std::clamp(top, 0L, static_cast<LONG>(framePoolHeight_) - copyHeight);
    cropRect_ = {left, top, left + copyWidth, top + copyHeight};
    return true;
}

void WgcSession::setFrameCallback(FrameCallback callback) {
    frameCallback_ = std::move(callback);
}

bool WgcSession::startCapture() {
    if (!session_ || !framePool_) return false;

    capturing_ = true;
    fatalError_ = false;
    firstFrameReceived_ = false;
    lastFrameTimeHns_ = 0;

    frameArrivedRevoker_ = framePool_.FrameArrived(
        winrt::auto_revoke,
        [this](auto const& sender, auto const& args) {
            onFrameArrived(sender, args);
        });

    session_.StartCapture();
    return true;
}

bool WgcSession::waitForFirstFrame(int timeoutMs) const {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);
    while (!firstFrameReceived_ && !fatalError_ && std::chrono::steady_clock::now() < deadline) {
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    return firstFrameReceived_.load();
}

bool WgcSession::startDesktopDuplication() {
    stopCapture();
    if (!captureOutput_) return false;

    DXGI_OUTPUT_DESC desc{};
    HRESULT hr = captureOutput_->GetDesc(&desc);
    if (FAILED(hr) || (desc.Rotation != DXGI_MODE_ROTATION_IDENTITY &&
                       desc.Rotation != DXGI_MODE_ROTATION_UNSPECIFIED)) {
        std::cerr << "ERROR: Desktop Duplication requires an unrotated output" << std::endl;
        return false;
    }
    hr = captureOutput_->DuplicateOutput(d3dDevice_.Get(), &desktopDuplication_);
    if (FAILED(hr)) {
        std::cerr << "ERROR: DuplicateOutput failed: 0x" << std::hex << hr << std::dec << std::endl;
        return false;
    }
    if (windowHandle_ && !initializeWindowCrop(windowHandle_)) return false;

    firstFrameReceived_ = false;
    fatalError_ = false;
    capturing_ = true;
    lastFrameTimeHns_ = 0;
    pollDesktopDuplicationFrame(1000);
    if (!firstFrameReceived_) return false;

    std::cerr << "INFO: Native capture backend: desktop-duplication" << std::endl;
    return true;
}

void WgcSession::pollDesktopDuplicationFrame(UINT timeoutMs) {
    if (!desktopDuplication_ || !capturing_ || fatalError_) return;

    DXGI_OUTDUPL_FRAME_INFO frameInfo{};
    ComPtr<IDXGIResource> resource;
    HRESULT hr = desktopDuplication_->AcquireNextFrame(timeoutMs, &frameInfo, &resource);
    if (hr == DXGI_ERROR_WAIT_TIMEOUT) return;
    if (hr == DXGI_ERROR_ACCESS_LOST) {
        desktopDuplication_.Reset();
        hr = captureOutput_->DuplicateOutput(d3dDevice_.Get(), &desktopDuplication_);
        if (SUCCEEDED(hr)) return;
    }
    if (FAILED(hr)) {
        fatalError_ = true;
        std::cerr << "ERROR: Desktop Duplication capture failed: 0x"
                  << std::hex << hr << std::dec << std::endl;
        return;
    }

    ComPtr<ID3D11Texture2D> texture;
    hr = resource.As(&texture);
    if (SUCCEEDED(hr)) {
        D3D11_TEXTURE2D_DESC desc{};
        texture->GetDesc(&desc);
        framePoolWidth_ = static_cast<int>(desc.Width);
        framePoolHeight_ = static_cast<int>(desc.Height);
        LARGE_INTEGER counter{}, frequency{};
        QueryPerformanceCounter(&counter);
        QueryPerformanceFrequency(&frequency);
        const int64_t timestampHns = static_cast<int64_t>(
            static_cast<long double>(counter.QuadPart) * 10000000.0L / frequency.QuadPart);
        deliverFrame(texture.Get(), timestampHns);
    }
    desktopDuplication_->ReleaseFrame();
    if (FAILED(hr)) {
        fatalError_ = true;
        std::cerr << "ERROR: Desktop Duplication texture access failed: 0x"
                  << std::hex << hr << std::dec << std::endl;
    }
}

void WgcSession::stopCapture() {
    capturing_ = false;

    frameArrivedRevoker_.revoke();
    std::lock_guard<std::mutex> lock(frameMutex_);

    if (session_) {
        session_.Close();
        session_ = nullptr;
    }
    if (framePool_) {
        framePool_.Close();
        framePool_ = nullptr;
    }
    desktopDuplication_.Reset();
    cropTexture_.Reset();
    cropRenderTargetView_.Reset();
}

void WgcSession::onFrameArrived(
    winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool const& sender,
    winrt::Windows::Foundation::IInspectable const&) {

    std::lock_guard<std::mutex> lock(frameMutex_);
    if (!capturing_ || fatalError_ || desktopDuplication_) return;

    auto frame = sender.TryGetNextFrame();
    if (!frame) return;
    auto contentSize = frame.ContentSize();
    if (recreateFramePoolIfNeeded(contentSize)) {
        frame.Close();
        return;
    }

    auto timestamp = frame.SystemRelativeTime();
    int64_t frameTimeHns = std::chrono::duration_cast<std::chrono::duration<int64_t, std::ratio<1, 10000000>>>(timestamp).count();

    auto surface = frame.Surface();

    // Get the underlying D3D texture from the WinRT surface via COM interop
    winrt::com_ptr<IDirect3DDxgiInterfaceAccess> access;
    try {
        access = surface.as<IDirect3DDxgiInterfaceAccess>();
    } catch (...) {
        frame.Close();
        return;
    }
    ComPtr<ID3D11Texture2D> texture;
    HRESULT hr = access->GetInterface(IID_PPV_ARGS(&texture));

    if (SUCCEEDED(hr) && texture) {
        deliverFrame(texture.Get(), frameTimeHns);
    }

    frame.Close();
}

void WgcSession::deliverFrame(ID3D11Texture2D* texture, int64_t timestampHns) {
    // Apply the same frame-rate limit to both native capture backends.
    if (lastFrameTimeHns_ > 0 && (timestampHns - lastFrameTimeHns_) < (frameIntervalHns_ * 7 / 10)) return;
    lastFrameTimeHns_ = timestampHns;
    if (frameCallback_) {
        if (windowHandle_ && cropTexture_ && updateWindowCropRect()) {
            constexpr float clearColor[4] = {0.0f, 0.0f, 0.0f, 1.0f};
            d3dContext_->ClearRenderTargetView(cropRenderTargetView_.Get(), clearColor);
            D3D11_BOX sourceBox{
                static_cast<UINT>(cropRect_.left), static_cast<UINT>(cropRect_.top), 0,
                static_cast<UINT>(cropRect_.right), static_cast<UINT>(cropRect_.bottom), 1,
            };
            d3dContext_->CopySubresourceRegion(cropTexture_.Get(), 0, 0, 0, 0, texture, 0, &sourceBox);
            frameCallback_(cropTexture_.Get(), timestampHns);
            firstFrameReceived_ = true;
        } else if (!windowHandle_) {
            frameCallback_(texture, timestampHns);
            firstFrameReceived_ = true;
        }
    }
}
