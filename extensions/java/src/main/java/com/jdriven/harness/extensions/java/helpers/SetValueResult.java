package com.jdriven.harness.extensions.java.helpers;

/** What {@link ModRules#setValue} did. Use it in a {@code switch} with a case for each. */
public sealed interface SetValueResult {
    /** Changed in {@code file}; the value was {@code oldValue}. */
    record Changed(String file, String oldValue) implements SetValueResult {
    }

    /** No rules file defines the actor. */
    record NoSuchActor() implements SetValueResult {
    }

    /** The actor in {@code file} has no such trait of its own: it may inherit it. */
    record NoSuchTrait(String file) implements SetValueResult {
    }

    /** The actor's trait in {@code file} has no such key of its own: it may inherit it. */
    record NoSuchKey(String file) implements SetValueResult {
    }
}
