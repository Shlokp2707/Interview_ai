import os
import base64
import hashlib
import requests
from django.conf import settings
from cryptography.fernet import Fernet

def get_fernet():
    """Derives a 32-byte Fernet key deterministically from Django's SECRET_KEY."""
    secret = getattr(settings, "SECRET_KEY", "default-insecure-secret-key-1234567890")
    key = hashlib.sha256(secret.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(key))

def encrypt_key(plaintext_key: str) -> str:
    if not plaintext_key:
        return ""
    f = get_fernet()
    return f.encrypt(plaintext_key.strip().encode("utf-8")).decode("utf-8")

def decrypt_key(ciphertext_key: str) -> str:
    if not ciphertext_key:
        return ""
    try:
        f = get_fernet()
        return f.decrypt(ciphertext_key.encode("utf-8")).decode("utf-8")
    except Exception as e:
        print(f"[KeyManager] Decryption error: {e}")
        return ""

def mask_key(api_key: str) -> str:
    """Masks an API key for UI display (e.g. gsk_abc...1234)."""
    if not api_key:
        return ""
    api_key = api_key.strip()
    if len(api_key) <= 10:
        return "********"
    return f"{api_key[:6]}...{api_key[-4:]}"

def get_user_key_details(user, provider: str) -> dict:
    """
    Retrieves full active key object details (key, base_url, selected_model, provider_name).
    """
    from .models import UserApiKey
    provider = provider.lower().strip()
    
    if user and user.is_authenticated:
        try:
            key_obj = UserApiKey.objects.filter(user=user, provider=provider, is_active=True).first()
            if key_obj and key_obj.encrypted_key:
                decrypted = decrypt_key(key_obj.encrypted_key)
                if decrypted:
                    return {
                        "key": decrypted,
                        "base_url": key_obj.api_base_url,
                        "selected_model": key_obj.selected_model,
                        "provider_name": key_obj.provider_name or provider.capitalize()
                    }
        except Exception as e:
            print(f"[KeyManager] Error fetching user key for {provider}: {e}")

    # Default fallback
    fallback_key = get_api_key_for_user(user, provider)
    return {
        "key": fallback_key,
        "base_url": "",
        "selected_model": "",
        "provider_name": provider.capitalize()
    }


def get_api_key_for_user(user, provider: str) -> str:
    """
    Retrieves the active API key for a user and provider.
    Falls back to settings.<PROVIDER>_API_KEY if user key is not set.
    """
    from .models import UserApiKey

    provider = provider.lower().strip()
    
    if user and user.is_authenticated:
        try:
            key_obj = UserApiKey.objects.filter(user=user, provider=provider, is_active=True).first()
            if key_obj and key_obj.encrypted_key:
                decrypted = decrypt_key(key_obj.encrypted_key)
                if decrypted:
                    return decrypted
        except Exception as e:
            print(f"[KeyManager] Error fetching user key for {provider}: {e}")

    # Fallback to system default settings keys
    key = ""
    if provider == "groq":
        key = getattr(settings, "GROQ_API_KEY", "") or os.getenv("GROQ_API_KEY", "")
    elif provider in ("gemini", "google"):
        key = getattr(settings, "GOOGLE_API_KEY", "") or os.getenv("GOOGLE_API_KEY", "")
    elif provider == "openai":
        key = os.getenv("OPENAI_API_KEY", "")
    elif provider == "anthropic":
        key = os.getenv("ANTHROPIC_API_KEY", "")
    elif provider == "tavily":
        key = getattr(settings, "TAVILY_API_KEY", "") or os.getenv("TAVILY_API_KEY", "")

    if key and ("your_" in key.lower() or "placeholder" in key.lower()):
        return ""
    return key


from urllib.parse import urlparse

def is_safe_url(url: str) -> bool:
    """Prevents SSRF attacks targeting internal cloud metadata IP addresses."""
    if not url:
        return True
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower()
    if not hostname or parsed.scheme not in ("http", "https"):
        return False
    blocked = ["169.254.", "169.254.169.254", "metadata.google", "metadata.nic"]
    for b in blocked:
        if b in hostname:
            return False
    return True

def validate_api_key(provider: str, api_key: str, api_base_url: str = "") -> tuple:
    """
    Validates an API key by sending a minimal lightweight ping to the provider's API.
    Returns (is_valid: bool, message: str)
    """
    provider = provider.lower().strip()
    api_key = api_key.strip()
    
    if not api_key:
        return False, "API key cannot be empty."

    if api_base_url and not is_safe_url(api_base_url):
        return False, "Security error: Invalid or blocked API Base URL."


    try:
        if provider == "groq":
            resp = requests.get(
                "https://api.groq.com/openai/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=8
            )
            if resp.status_code == 200:
                return True, "Groq API Key is valid and active!"
            else:
                return False, f"Groq validation failed: HTTP {resp.status_code} - {resp.json().get('error', {}).get('message', 'Invalid key')}"

        elif provider in ("gemini", "google"):
            resp = requests.get(
                f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}",
                timeout=8
            )
            if resp.status_code == 200:
                return True, "Google Gemini API Key is valid and active!"
            else:
                return False, f"Gemini validation failed: HTTP {resp.status_code} - {resp.json().get('error', {}).get('message', 'Invalid key')}"

        elif provider == "openai":
            base_url = api_base_url.rstrip("/") if api_base_url else "https://api.openai.com/v1"
            resp = requests.get(
                f"{base_url}/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=8
            )
            if resp.status_code == 200:
                return True, "OpenAI API Key is valid and active!"
            else:
                return False, f"OpenAI validation failed: HTTP {resp.status_code}"

        elif provider == "openrouter":
            resp = requests.get(
                "https://openrouter.ai/api/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=8
            )
            if resp.status_code == 200:
                return True, "OpenRouter API Key is valid and active!"
            else:
                return False, f"OpenRouter validation failed: HTTP {resp.status_code}"

        elif provider == "deepseek":
            resp = requests.get(
                "https://api.deepseek.com/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=8
            )
            if resp.status_code == 200:
                return True, "DeepSeek API Key is valid and active!"
            else:
                return False, f"DeepSeek validation failed: HTTP {resp.status_code}"

        elif provider == "anthropic":
            resp = requests.get(
                "https://api.anthropic.com/v1/models",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01"
                },
                timeout=8
            )
            if resp.status_code in (200, 400):
                return True, "Anthropic API Key structure accepted!"
            else:
                return False, f"Anthropic validation failed: HTTP {resp.status_code}"

        elif provider == "elevenlabs":
            resp = requests.get(
                "https://api.elevenlabs.io/v1/user",
                headers={"xi-api-key": api_key},
                timeout=8
            )
            if resp.status_code == 200:
                return True, "ElevenLabs Voice API Key is valid!"
            else:
                return False, f"ElevenLabs validation failed: HTTP {resp.status_code}"

        elif provider == "tavily":
            if len(api_key) > 8 and api_key.startswith("tvly-"):
                return True, "Tavily Search API Key structure accepted!"
            return False, "Tavily keys usually start with tvly-"

        # Generic / Custom OpenAI-Compatible Provider
        if api_base_url:
            base_url = api_base_url.rstrip("/")
            try:
                resp = requests.get(
                    f"{base_url}/models",
                    headers={"Authorization": f"Bearer {api_key}"},
                    timeout=8
                )
                if resp.status_code in (200, 401, 403):
                    if resp.status_code == 200:
                        return True, f"Custom endpoint ({base_url}) responded successfully!"
                    return False, f"Custom endpoint auth failed: HTTP {resp.status_code}"
            except Exception:
                pass

        # If custom key has non-empty string, mark accepted
        return True, f"Custom key for '{provider}' saved successfully!"

    except requests.RequestException as e:
        return False, f"Connection error verifying key: {str(e)}"

