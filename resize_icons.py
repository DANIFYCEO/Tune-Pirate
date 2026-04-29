from PIL import Image
import os

icon_path = r"C:\Users\Joseph\.gemini\antigravity\brain\2fb81433-d5eb-44ac-bd79-e41f1990bdaf\tune_pirate_mono_1777467401538.png"
base = r"C:\Users\Joseph\.gemini\antigravity\scratch\TunePirateApp\frontend\android\app\src\main\res"

# App icon sizes
icon_sizes = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

img = Image.open(icon_path).convert("RGBA")

for folder, size in icon_sizes.items():
    folder_path = os.path.join(base, folder)
    os.makedirs(folder_path, exist_ok=True)
    resized = img.resize((size, size), Image.LANCZOS)
    resized.save(os.path.join(folder_path, "ic_launcher.png"), "PNG")
    resized.save(os.path.join(folder_path, "ic_launcher_round.png"), "PNG")
    resized.save(os.path.join(folder_path, "ic_launcher_foreground.png"), "PNG")
    print(f"Saved {size}x{size} icons to {folder}")

# Splash screen sizes - centered icon on black background
splash_sizes = {
    "drawable-port-mdpi": (320, 480),
    "drawable-port-hdpi": (480, 800),
    "drawable-port-xhdpi": (720, 1280),
    "drawable-port-xxhdpi": (1080, 1920),
    "drawable-port-xxxhdpi": (1440, 2560),
    "drawable-land-mdpi": (480, 320),
    "drawable-land-hdpi": (800, 480),
    "drawable-land-xhdpi": (1280, 720),
    "drawable-land-xxhdpi": (1920, 1080),
    "drawable-land-xxxhdpi": (2560, 1440),
}

for folder, (w, h) in splash_sizes.items():
    folder_path = os.path.join(base, folder)
    os.makedirs(folder_path, exist_ok=True)
    # Create black background
    splash = Image.new("RGBA", (w, h), (0, 0, 0, 255))
    # Resize icon to fit nicely (about 30% of the smaller dimension)
    icon_size = int(min(w, h) * 0.3)
    icon_resized = img.resize((icon_size, icon_size), Image.LANCZOS)
    # Center it
    x = (w - icon_size) // 2
    y = (h - icon_size) // 2
    splash.paste(icon_resized, (x, y), icon_resized)
    splash.convert("RGB").save(os.path.join(folder_path, "splash.png"), "PNG")
    print(f"Saved {w}x{h} splash to {folder}")

# Also save the default drawable splash
drawable_path = os.path.join(base, "drawable")
os.makedirs(drawable_path, exist_ok=True)
splash = Image.new("RGBA", (720, 1280), (0, 0, 0, 255))
icon_size = int(720 * 0.3)
icon_resized = img.resize((icon_size, icon_size), Image.LANCZOS)
x = (720 - icon_size) // 2
y = (1280 - icon_size) // 2
splash.paste(icon_resized, (x, y), icon_resized)
splash.convert("RGB").save(os.path.join(drawable_path, "splash.png"), "PNG")
print("Saved default drawable splash")

print("All done!")
