package com.jdriven.harness.extensions.java.helpers;

/** An actor (unit, building, ...) with its in-game name, and the rules file that defines it. */
public record Actor(String id, String name, String file) {
}
