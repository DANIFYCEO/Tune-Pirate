from PIL import Image
import os

icon_path = r"C:\Users\Joseph\.gemini\antigravity\brain\2fb81433-d5eb-44ac-bd79-e41f1990bdaf\tune_pirate_icon_1777464947756.png"
base = r"C:\Users\Joseph\.gemini\antigravity\scratch\TunePirateApp\frontend\android\app\src\main\res"

sizes = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

img = Image.open(icon_path).convert("RGBA")

for folder, size in sizes.items():
    folder_path = os.path.join(base, folder)
    os.makedirs(folder_path, exist_ok=True)
    resized = img.resize((size, size), Image.LANCZOS)
    # Save as ic_launcher.png
    resized.save(os.path.join(folder_path, "ic_launcher.png"), "PNG")
    # Save as ic_launcher_round.png (same image)
    resized.save(os.path.join(folder_path, "ic_launcher_round.png"), "PNG")
    # Save as ic_launcher_foreground.png
    resized.save(os.path.join(folder_path, "ic_launcher_foreground.png"), "PNG")
    print(f"Saved {size}x{size} icons to {folder}")

print("Done!")
