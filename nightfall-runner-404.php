<?php
/**
 * Plugin Name: Nightfall Runner 404
 * Description: Displays Nightfall Runner on GeneratePress 404 pages.
 * Version: 1.5.0
 * Author: Nightfall Automotive
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/** Add a class so the 404 page can be styled without affecting other pages. */
add_filter( 'body_class', function ( $classes ) {
    if ( is_404() ) {
        $classes[] = 'nightfall-runner-404-page';
    }
    return $classes;
} );

/** Remove the default GeneratePress 404 template content. */
add_filter( 'generate_do_template_part', function ( $output, $template ) {
    if ( is_404() && '404' === $template ) {
        return '';
    }
    return $output;
}, 10, 2 );

/** Use a full-width layout and remove the sidebar on 404 pages. */
add_filter( 'generate_sidebar_layout', function ( $layout ) {
    return is_404() ? 'no-sidebar' : $layout;
} );

/** Add targeted styling to hide the theme footer and give the game room. */
add_action( 'wp_head', function () {
    if ( ! is_404() ) {
        return;
    }
    ?>
    <style id="nightfall-runner-404-styles">
      body.nightfall-runner-404-page #site-footer,
      body.nightfall-runner-404-page .site-footer,
      body.nightfall-runner-404-page footer.site-info,
      body.nightfall-runner-404-page #right-sidebar,
      body.nightfall-runner-404-page #left-sidebar,
      body.nightfall-runner-404-page .sidebar,
      body.nightfall-runner-404-page .widget-area {
        display: none !important;
      }
      body.nightfall-runner-404-page #primary,
      body.nightfall-runner-404-page .content-area,
      body.nightfall-runner-404-page .site-main,
      body.nightfall-runner-404-page .site-content {
        width: 100% !important;
        max-width: 100% !important;
        float: none !important;
      }
      body.nightfall-runner-404-page .nightfall-runner-404 {
        width: 100%;
        max-width: 1440px;
        margin: 0 auto;
        padding: 0 20px 24px;
        box-sizing: border-box;
      }
      body.nightfall-runner-404-page .nightfall-runner-404 h1 {
        margin: 0 0 8px;
        color: #eceff4;
      }
      body.nightfall-runner-404-page .nightfall-runner-404 > p:not(.nightfall-runner-home) {
        margin: 0 0 24px;
        color: #eceff4;
      }

      /* The game canvas is 16:9, so the iframe height is derived from its width:
         width x 9/16, plus the console bars the embed mode still shows
         (top bar + footer + decoration + borders). This avoids empty bands
         around the game that a fixed pixel height would leave. */
      body.nightfall-runner-404-page .nightfall-runner-404 iframe {
        display: block;
        width: 100%;
        height: calc((min(100vw, 1440px) - 40px) * 0.5625 + 98px);
        border: 0;
        overflow: hidden;
        background: #20242d;
      }
      body.nightfall-runner-404-page .nightfall-runner-home {
        margin: 18px 0 0;
        text-align: center;
      }
      @media (max-width: 700px) {
        body.nightfall-runner-404-page .nightfall-runner-404 {
          padding: 0 10px 18px;
        }
        body.nightfall-runner-404-page .nightfall-runner-404 iframe {
          height: calc((100vw - 20px) * 0.5625 + 98px);
        }
      }
      @media (max-width: 520px) {
        /* Embed mode uses slimmer bars on small screens. */
        body.nightfall-runner-404-page .nightfall-runner-404 iframe {
          height: calc((100vw - 20px) * 0.5625 + 84px);
        }
      }
    </style>
    <?php
} );

/** Render Nightfall Runner instead of the standard 404 content. */
add_action( 'generate_before_main_content', function () {
    if ( ! is_404() ) {
        return;
    }
    ?>
    <div class="nightfall-runner-404">
        <h1>Wrong turn. Right game.</h1>
        <p>You've taken a wrong turn. See how far you can drive before the next breakdown.</p>
        <iframe
            src="<?php echo esc_url( home_url( '/nightfall-runner/?embed=1' ) ); ?>"
            title="Nightfall Runner arcade game">
        </iframe>
        <p class="nightfall-runner-home">
            <a href="<?php echo esc_url( home_url( '/' ) ); ?>">&larr; Back to Nightfall Automotive</a>
        </p>
    </div>
    <?php
}, 5 );
