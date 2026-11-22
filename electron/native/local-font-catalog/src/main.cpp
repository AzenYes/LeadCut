#include <windows.h>
#include <dwrite.h>
#include <wrl/client.h>

#include <cstdio>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>

using Microsoft::WRL::ComPtr;

static void check(HRESULT result) {
    if (FAILED(result)) throw std::runtime_error("DirectWrite font enumeration failed");
}

static std::string toUtf8(const std::wstring& name) {
    const int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, name.data(),
        static_cast<int>(name.size()), nullptr, 0, nullptr, nullptr);
    if (size <= 0) return {};
    std::string utf8(size, '\0');
    if (!WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, name.data(),
            static_cast<int>(name.size()), utf8.data(), size, nullptr, nullptr)) return {};
    return utf8;
}

int main() {
    try {
        ComPtr<IDWriteFactory> factory;
        check(DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory),
            reinterpret_cast<IUnknown**>(factory.GetAddressOf())));

        ComPtr<IDWriteFontCollection> collection;
        check(factory->GetSystemFontCollection(&collection));

        std::set<std::wstring> names;
        const UINT32 familyCount = collection->GetFontFamilyCount();
        for (UINT32 familyIndex = 0; familyIndex < familyCount; ++familyIndex) {
            ComPtr<IDWriteFontFamily> family;
            ComPtr<IDWriteLocalizedStrings> localizedNames;
            check(collection->GetFontFamily(familyIndex, &family));
            check(family->GetFamilyNames(&localizedNames));

            const UINT32 nameCount = localizedNames->GetCount();
            for (UINT32 nameIndex = 0; nameIndex < nameCount; ++nameIndex) {
                UINT32 length = 0;
                check(localizedNames->GetStringLength(nameIndex, &length));
                if (!length) continue;

                std::wstring name(length + 1, L'\0');
                check(localizedNames->GetString(nameIndex, name.data(), length + 1));
                name.resize(length);
                if (name.find_first_of(L"\r\n") == std::wstring::npos &&
                    name.find(L'\0') == std::wstring::npos) names.insert(std::move(name));
            }
        }

        for (const auto& name : names) {
            const std::string utf8 = toUtf8(name);
            if (!utf8.empty() && std::puts(utf8.c_str()) == EOF) return 1;
        }
        return std::fflush(stdout) == 0 ? 0 : 1;
    } catch (const std::exception& error) {
        std::fprintf(stderr, "%s\n", error.what());
        return 1;
    }
}
