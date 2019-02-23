const api_url = "http://localhost:8081";

// Init ace editor
ace.require("ace/ext/language_tools");

var editor = ace.edit("logstash_filter_textarea");
editor.session.setMode("ace/mode/ruby");
editor.session.setTabSize(2);

editor.setOptions({
  fontSize: "12pt",
  enableBasicAutocompletion: true,
  enableLiveAutocompletion: true,
  indentedSoftWrap: true,
  useSoftTabs: true,
  showPrintMargin: false,
  enableSnippets: false,
  navigateWithinSoftTabs: true,
  keyboardHandler: "ace/keyboard/sublime"
})

// Theme color

function enableBlackTheme() {
  $('#css_theme_bootstrap').attr('href','./css/bootstrap-black.min.css');
  $('#css_theme_custom').attr('href','./css/custom-black.css');

  editor.setTheme("ace/theme/dracula");

  console.log("enable black theme")
}

function enableWhiteTheme() {
  $('#css_theme_bootstrap').attr('href','./css/bootstrap.min.css');
  $('#css_theme_custom').attr('href','./css/custom.css');

  editor.setTheme("ace/theme/clouds");

  console.log("enable white theme")
}


function jobFailed(reason) {
  $("#start_process").removeClass('disabled');
  $('#failModal').modal('show');
  $('#failModalReason').html(reason);

  $("#start_process").removeClass('disabled');
  $('#output').text('No data was receive from Logstash :(');
}

$('#clean_form').click(function () {
  $('#input_data_textarea').val("");
  editor.setValue("", -1);
  $('#output').text("The Logstash output will be shown here !");
  saveSession();
});

$('#fill_form').click(function () {

  $.ajax({
    url: "./sample/data.txt",
    success: function (data){
      $('#input_data_textarea').val(data);
    }
  });

  $.ajax({
    url: "./sample/filter.conf",
    success: function (data){
      editor.setValue(data, -1);
    }
  });

});

function userInputValid() {
  input_valid = true;

  var input_data = $('#input_data_textarea').val();
  var logstash_filter = editor.getValue();

  if (input_data.length == 0) {
    $('#input_data_textarea').addClass("is-invalid");
    input_valid = false;
  } else {
    $('#input_data_textarea').removeClass("is-invalid");
  }

  if (logstash_filter.length == 0) {
    $('#logstash_filter_title').addClass("text-danger");
    input_valid = false;
  } else {
    $('#logstash_filter_title').removeClass("text-danger");
  }

  return input_valid
}

$('#start_process').click(function () {

  saveSession()

  if (userInputValid()) {

    var body = {
      input_data: $('#input_data_textarea').val(),
      logstash_filter: editor.getValue()
    };

    $('#output').html('<div class="spinner-border" style="display: block; margin: auto;" role="status><span class="sr-only"></span></div>');
    $("#start_process").addClass('disabled');

    $.ajax({
      url: api_url + "/start_process",
      type: "POST",
      data: JSON.stringify(body),
      contentType: "application/json",
      dataType: "json",
      timeout: 60000,
      success: function (data) {
        $('#output').text(data.job_result.stdout);
        $("#start_process").removeClass('disabled');
        if (data.job_result.status != 0 || data.job_result.stdout.startsWith("[ERROR]")) {
          toastr.error('There was a problem in your configuration.', 'Error')
        } else {
          toastr.success('Configuration parsing is done !', 'Success')
        }
      },
      error: function () {
        jobFailed("Unable to obtain a response from the backend server.<br/>You cannot do anything to solve it, please contact the maintainer of this project.")
      }
    });

  }

});

// Save and load user session

function saveSession() {
  console.log("Saving session into cookie")
  var session = {
    theme: ($('#css_theme_bootstrap').attr('href').includes('bootstrap.min.css')? "white" : "black"),
    input_data: $('#input_data_textarea').val(),
    logstash_filter: editor.getValue()
  }
  Cookies.set('session', session, { expires: 7 });
}

function loadSession() {
  var session = Cookies.get('session');
  if (session != undefined) {
    var session = JSON.parse(session)
    console.log("Loading user session")
    session.theme == "white" ? enableWhiteTheme() : enableBlackTheme()
    $('#input_data_textarea').val(session.input_data)
    editor.setValue(session.logstash_filter, -1)
  } else {
    console.log("No cookie for session found")
  }
}

// Change theme button

$('#change_theme').click(function (){
  if($('#css_theme_bootstrap').attr('href').includes('bootstrap.min.css')) {
    enableBlackTheme()
    saveSession()
  } else {
    enableWhiteTheme()
    saveSession()
  }
});

loadSession()