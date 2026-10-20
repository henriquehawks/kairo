use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, GetKeyboardLayoutList, MapVirtualKeyExW, SendInput, ToUnicodeEx, HKL, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_KEYUP, MAPVK_VK_TO_VSC_EX, VIRTUAL_KEY, VK_0, VK_A, VK_CONTROL, VK_LCONTROL, VK_LMENU, VK_LSHIFT, VK_LWIN, VK_MENU, VK_OEM_1, VK_OEM_2, VK_OEM_3,
    VK_OEM_4, VK_OEM_5, VK_OEM_6, VK_OEM_7, VK_OEM_COMMA, VK_OEM_MINUS, VK_OEM_PERIOD, VK_OEM_PLUS, VK_RCONTROL, VK_RMENU, VK_RSHIFT, VK_RWIN, VK_SHIFT,
    VK_SNAPSHOT,
};

fn tecla_virtual(codigo: Code) -> Option<VIRTUAL_KEY> {
    let letras = [
        Code::KeyA, Code::KeyB, Code::KeyC, Code::KeyD, Code::KeyE, Code::KeyF, Code::KeyG, Code::KeyH, Code::KeyI, Code::KeyJ, Code::KeyK, Code::KeyL, Code::KeyM,
        Code::KeyN, Code::KeyO, Code::KeyP, Code::KeyQ, Code::KeyR, Code::KeyS, Code::KeyT, Code::KeyU, Code::KeyV, Code::KeyW, Code::KeyX, Code::KeyY, Code::KeyZ,
    ];
    let digitos = [Code::Digit0, Code::Digit1, Code::Digit2, Code::Digit3, Code::Digit4, Code::Digit5, Code::Digit6, Code::Digit7, Code::Digit8, Code::Digit9];
    if let Some(i) = letras.iter().position(|c| *c == codigo) {
        return Some(VIRTUAL_KEY(VK_A.0 + i as u16));
    }
    if let Some(i) = digitos.iter().position(|c| *c == codigo) {
        return Some(VIRTUAL_KEY(VK_0.0 + i as u16));
    }
    Some(match codigo {
        Code::Backquote => VK_OEM_3,
        Code::BracketLeft => VK_OEM_4,
        Code::Backslash => VK_OEM_5,
        Code::BracketRight => VK_OEM_6,
        Code::Quote => VK_OEM_7,
        Code::Semicolon => VK_OEM_1,
        Code::Slash => VK_OEM_2,
        Code::Comma => VK_OEM_COMMA,
        Code::Period => VK_OEM_PERIOD,
        Code::Minus => VK_OEM_MINUS,
        Code::Equal => VK_OEM_PLUS,
        _ => return None,
    })
}

pub fn digita_com_altgr(atalho: &Shortcut) -> bool {
    let mods = atalho.mods;
    if !(mods.contains(Modifiers::CONTROL) && mods.contains(Modifiers::ALT)) {
        return false;
    }
    let Some(vk) = tecla_virtual(atalho.key) else { return false };
    let mut estado = [0u8; 256];
    for tecla in [VK_CONTROL, VK_LCONTROL, VK_MENU, VK_LMENU, VK_RMENU] {
        estado[tecla.0 as usize] = 0x80;
    }
    if mods.contains(Modifiers::SHIFT) {
        estado[VK_SHIFT.0 as usize] = 0x80;
        estado[VK_LSHIFT.0 as usize] = 0x80;
    }
    unsafe {
        let total = GetKeyboardLayoutList(None);
        let mut layouts = vec![HKL::default(); total.max(0) as usize];
        let lidos = GetKeyboardLayoutList(Some(&mut layouts)).max(0) as usize;
        layouts.iter().take(lidos).any(|layout| {
            let varredura = MapVirtualKeyExW(vk.0 as u32, MAPVK_VK_TO_VSC_EX, Some(*layout));
            let mut texto = [0u16; 8];
            ToUnicodeEx(vk.0 as u32, varredura, &estado, &mut texto, 4, Some(*layout)) != 0
        })
    }
}

// Aperta Print Screen pelo teclado virtual, para a ferramenta de captura do
// usuário (Lightshot, ShareX, a do Windows) responder como se ele tivesse
// apertado a tecla. Os modificadores do atalho que disparou isso ainda estão
// pressionados, e com eles a tecla vira outra combinação — por isso eles são
// soltos antes.
pub fn apertar_print() -> bool {
    let modificadores = [VK_CONTROL, VK_LCONTROL, VK_RCONTROL, VK_MENU, VK_LMENU, VK_RMENU, VK_SHIFT, VK_LSHIFT, VK_RSHIFT, VK_LWIN, VK_RWIN];
    let mut teclas: Vec<INPUT> = modificadores
        .into_iter()
        .filter(|vk| unsafe { GetAsyncKeyState(vk.0 as i32) } < 0)
        .map(|vk| evento_de_tecla(vk, true))
        .collect();
    teclas.push(evento_de_tecla(VK_SNAPSHOT, false));
    teclas.push(evento_de_tecla(VK_SNAPSHOT, true));
    let enviados = unsafe { SendInput(&teclas, std::mem::size_of::<INPUT>() as i32) };
    enviados as usize == teclas.len()
}

fn evento_de_tecla(tecla: VIRTUAL_KEY, soltar: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: tecla,
                wScan: 0,
                dwFlags: if soltar { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}
