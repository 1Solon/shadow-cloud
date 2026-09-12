"""Native acceptance operations scoped to the runner's private session bus."""

import ctypes
import ctypes.util
import json
import os
import sys

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib

if os.environ.get("COMPANION_NATIVE_PRIVATE_BUS") != "true":
    raise RuntimeError("Native automation requires its private test session bus")

bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)


def call(destination, path, interface, method, signature, arguments):
    parameters = GLib.Variant(signature, arguments) if signature else None
    return bus.call_sync(
        destination, path, interface, method, parameters, None,
        Gio.DBusCallFlags.NONE, 5000, None,
    ).unpack()


def property_value(destination, path, interface, name):
    return call(destination, path, "org.freedesktop.DBus.Properties", "Get", "(ss)", (interface, name))[0]


def tray():
    items = property_value("org.kde.StatusNotifierWatcher", "/StatusNotifierWatcher",
                           "org.kde.StatusNotifierWatcher", "RegisteredStatusNotifierItems")
    active = []
    for item in items:
        destination, item_path = item.split("/", 1)
        try:
            pid = call("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus",
                       "GetConnectionUnixProcessID", "(s)", (destination,))[0]
            active.append((destination, item_path, pid))
        except GLib.Error:
            # The synthetic watcher retains registrations after an app quits.
            continue
    if len(active) != 1:
        raise RuntimeError(f"Expected one private tray item, found {len(active)}")
    destination, item_path, pid = active[0]
    menu = property_value(destination, "/" + item_path, "org.kde.StatusNotifierItem", "Menu")
    return destination, menu, pid


def entries(layout):
    identifier, properties, children = layout
    result = [{"id": identifier, "label": properties.get("label"),
               "enabled": properties.get("enabled", True)}]
    for child in children:
        result.extend(entries(child))
    return result


def window_operation(pid, operation):
    # The app runs on X11 for automation even on Wayland hosts. Resolve only the
    # PID owning its item on the private bus; never search windows by title.
    x11 = ctypes.CDLL(ctypes.util.find_library("X11"))
    pointer = ctypes.c_void_p
    window = ctypes.c_ulong
    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XOpenDisplay.restype = pointer
    x11.XDefaultRootWindow.argtypes = [pointer]
    x11.XDefaultRootWindow.restype = window
    x11.XInternAtom.argtypes = [pointer, ctypes.c_char_p, ctypes.c_int]
    x11.XInternAtom.restype = window
    x11.XQueryTree.argtypes = [pointer, window, ctypes.POINTER(window), ctypes.POINTER(window),
                              ctypes.POINTER(ctypes.POINTER(window)), ctypes.POINTER(ctypes.c_uint)]
    x11.XGetWindowProperty.argtypes = [pointer, window, window, ctypes.c_long, ctypes.c_long,
                                     ctypes.c_int, window, ctypes.POINTER(window), ctypes.POINTER(ctypes.c_int),
                                     ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong),
                                     ctypes.POINTER(pointer)]
    x11.XFree.argtypes = [pointer]
    x11.XCloseDisplay.argtypes = [pointer]
    x11.XFlush.argtypes = [pointer]
    x11.XGetInputFocus.argtypes = [pointer, ctypes.POINTER(window), ctypes.POINTER(ctypes.c_int)]
    display = x11.XOpenDisplay(None)
    if not display:
        raise RuntimeError("An X11 DISPLAY is required for native window acceptance")

    class Attributes(ctypes.Structure):
        _fields_ = [(name, ctypes.c_int) for name in ["x", "y", "width", "height", "border", "depth"]] + [
            ("visual", pointer), ("root", window), ("class_", ctypes.c_int),
            ("bit_gravity", ctypes.c_int), ("win_gravity", ctypes.c_int), ("backing_store", ctypes.c_int),
            ("backing_planes", ctypes.c_ulong), ("backing_pixel", ctypes.c_ulong),
            ("save_under", ctypes.c_int), ("colormap", window), ("map_installed", ctypes.c_int),
            ("map_state", ctypes.c_int), ("all_event_masks", ctypes.c_long),
            ("your_event_mask", ctypes.c_long), ("do_not_propagate_mask", ctypes.c_long),
            ("override_redirect", ctypes.c_int), ("screen", pointer),
        ]

    x11.XGetWindowAttributes.argtypes = [pointer, window, ctypes.POINTER(Attributes)]

    def children(parent):
        root, ancestor, values, count = window(), window(), ctypes.POINTER(window)(), ctypes.c_uint()
        if not x11.XQueryTree(display, parent, ctypes.byref(root), ctypes.byref(ancestor),
                              ctypes.byref(values), ctypes.byref(count)):
            return []
        found = list(values[:count.value])
        if values:
            x11.XFree(values)
        return found

    def property_number(candidate, name):
        actual, fmt, count, after, data = window(), ctypes.c_int(), ctypes.c_ulong(), ctypes.c_ulong(), pointer()
        x11.XGetWindowProperty(display, candidate, x11.XInternAtom(display, name.encode(), False),
                               0, 1, False, 0, ctypes.byref(actual), ctypes.byref(fmt),
                               ctypes.byref(count), ctypes.byref(after), ctypes.byref(data))
        value = ctypes.cast(data, ctypes.POINTER(ctypes.c_ulong))[0] if data and count.value else None
        if data:
            x11.XFree(data)
        return value

    def window_title(candidate):
        actual, fmt, count, after, data = window(), ctypes.c_int(), ctypes.c_ulong(), ctypes.c_ulong(), pointer()
        x11.XGetWindowProperty(display, candidate, x11.XInternAtom(display, b"_NET_WM_NAME", False),
                               0, 1024, False, 0, ctypes.byref(actual), ctypes.byref(fmt),
                               ctypes.byref(count), ctypes.byref(after), ctypes.byref(data))
        value = ctypes.string_at(data, count.value).decode("utf8") if data and count.value else ""
        if data:
            x11.XFree(data)
        return value

    try:
        pending = children(x11.XDefaultRootWindow(display))
        matches = []
        while pending:
            candidate = pending.pop()
            if property_number(candidate, "_NET_WM_PID") == pid:
                attributes = Attributes()
                x11.XGetWindowAttributes(display, candidate, ctypes.byref(attributes))
                # Exclude GTK's tiny leader windows, which also carry the PID.
                selected = window_title(candidate) == "Choose the Shadow Cloud Companion root" if operation == "cancel-picker" else attributes.width >= 600 and attributes.height >= 400
                if selected:
                    matches.append((candidate, attributes))
            pending.extend(children(candidate))
        if len(matches) != 1:
            raise RuntimeError(f"Expected one window owned by private app PID {pid}, found {len(matches)}")
        candidate, attributes = matches[0]
        if operation in ("close", "cancel-picker"):
            class Data(ctypes.Union):
                _fields_ = [("l", ctypes.c_long * 5)]

            class ClientMessage(ctypes.Structure):
                _fields_ = [("type", ctypes.c_int), ("serial", ctypes.c_ulong),
                            ("send_event", ctypes.c_int), ("display", pointer), ("window", window),
                            ("message_type", window), ("format", ctypes.c_int), ("data", Data)]

            class Event(ctypes.Union):
                _fields_ = [("client", ClientMessage), ("padding", ctypes.c_long * 24)]

            event = Event()
            event.client.type = 33  # ClientMessage
            event.client.display = display
            event.client.window = candidate
            event.client.message_type = x11.XInternAtom(display, b"WM_PROTOCOLS", False)
            event.client.format = 32
            event.client.data.l[0] = x11.XInternAtom(display, b"WM_DELETE_WINDOW", False)
            x11.XSendEvent.argtypes = [pointer, window, ctypes.c_int, ctypes.c_long, ctypes.POINTER(Event)]
            x11.XSendEvent(display, candidate, False, 0, ctypes.byref(event))
            x11.XFlush(display)
            # The native handler may destroy the dialog/window immediately.
            return {"pid": pid, "window": candidate, "close_requested": True}
        focused, revert = window(), ctypes.c_int()
        x11.XGetInputFocus(display, ctypes.byref(focused), ctypes.byref(revert))
        descendants = [candidate]
        for child in descendants:
            descendants.extend(children(child))
        return {"pid": pid, "window": candidate, "visible": attributes.map_state == 2,
                "focused": focused.value in descendants}
    finally:
        x11.XCloseDisplay(display)


operation = sys.argv[1]
if operation == "host":
    call("org.kde.StatusNotifierWatcher", "/StatusNotifierWatcher", "com.shadowcloud.NativeTrayTest",
         "SetHostAvailable", "(b)", (sys.argv[2] == "true",))
    result = True
else:
    destination, menu, pid = tray()
    if operation in ("window", "close", "cancel-picker"):
        result = window_operation(pid, operation)
    else:
        layout = call(destination, menu, "com.canonical.dbusmenu", "GetLayout", "(iias)", (0, -1, []))[1]
        items = entries(layout)
        if operation == "click":
            found = [item for item in items if item["label"] == sys.argv[2] and item["enabled"]]
            if len(found) != 1:
                raise RuntimeError(f"Expected one enabled tray action {sys.argv[2]}")
            call(destination, menu, "com.canonical.dbusmenu", "Event", "(isvu)",
                 (found[0]["id"], "clicked", GLib.Variant("i", 0), 0))
        result = {"pid": pid, "items": items}
print(json.dumps(result))
